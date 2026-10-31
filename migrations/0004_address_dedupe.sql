-- Tidy saved addresses: checkout used to save a fresh copy every time the same
-- address was typed in. Keep the oldest copy of each, carry over its default
-- flags, and remove the rest. (New copies are no longer made: account.js.)

UPDATE addresses SET is_default = 1
 WHERE id IN (SELECT MIN(id) FROM addresses
               GROUP BY user_id, lower(name), phone, lower(address_line1), lower(IFNULL(address_line2,'')), lower(city), state_code, pincode
               HAVING MAX(is_default) = 1);

UPDATE addresses SET is_default_billing = 1
 WHERE id IN (SELECT MIN(id) FROM addresses
               GROUP BY user_id, lower(name), phone, lower(address_line1), lower(IFNULL(address_line2,'')), lower(city), state_code, pincode
               HAVING MAX(is_default_billing) = 1);

UPDATE addresses SET gstin = (SELECT d.gstin FROM addresses d WHERE d.user_id = addresses.user_id AND lower(d.name) = lower(addresses.name) AND d.phone = addresses.phone
                               AND lower(d.address_line1) = lower(addresses.address_line1) AND lower(IFNULL(d.address_line2,'')) = lower(IFNULL(addresses.address_line2,''))
                               AND lower(d.city) = lower(addresses.city) AND d.state_code = addresses.state_code AND d.pincode = addresses.pincode
                               AND d.gstin IS NOT NULL ORDER BY d.id DESC LIMIT 1),
                     business_name = COALESCE(business_name, (SELECT d.business_name FROM addresses d WHERE d.user_id = addresses.user_id AND lower(d.name) = lower(addresses.name) AND d.phone = addresses.phone
                               AND lower(d.address_line1) = lower(addresses.address_line1) AND lower(IFNULL(d.address_line2,'')) = lower(IFNULL(addresses.address_line2,''))
                               AND lower(d.city) = lower(addresses.city) AND d.state_code = addresses.state_code AND d.pincode = addresses.pincode
                               AND d.business_name IS NOT NULL ORDER BY d.id DESC LIMIT 1))
 WHERE gstin IS NULL;

DELETE FROM addresses
 WHERE id NOT IN (SELECT MIN(id) FROM addresses
                   GROUP BY user_id, lower(name), phone, lower(address_line1), lower(IFNULL(address_line2,'')), lower(city), state_code, pincode);
