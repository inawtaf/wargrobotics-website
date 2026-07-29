import React, { useState, useEffect } from 'react';
import { Image } from '@/components/ui/image';

const CAR_IMAGES = [
  'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/48f514f88_blue.png',
  'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/efb3d1c41_green.png',
  'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/183a3a0e3_red.png',
  'https://media.base44.com/images/public/6a6228d5d9e17113e1c6cb59/4bcfd0ca9_orannge.png',
];

export function CarSlideshow({ className = '', interval = 2500, showDots = true }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % CAR_IMAGES.length);
    }, interval);
    return () => clearInterval(timer);
  }, [interval]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {CAR_IMAGES.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt={`FPV car variant ${i + 1}`}
          fittingType="fit"
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] transition-opacity duration-700 ${i === index ? 'opacity-100' : 'opacity-0'}`}
        />
      ))}
      {showDots && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
          {CAR_IMAGES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={`h-2.5 rounded-full transition-all ${i === index ? 'bg-cyan w-6' : 'bg-white/60 w-2.5'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export { CAR_IMAGES };
