-- Unknown adjustments are not zero. A known net food-line total can still
-- establish a paid unit price without inventing its discount/fee breakdown.
ALTER TABLE feastjourney.restaurant_receipt_lines
 ALTER COLUMN discount DROP NOT NULL,
 ALTER COLUMN taxes_fees DROP NOT NULL;
