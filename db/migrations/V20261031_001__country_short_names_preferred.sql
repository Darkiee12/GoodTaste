-- Prefer short English country names in choosers and cards.
--
-- V20261030_004 seeded two English labels for these countries: the formal
-- registry name marked preferred and the short alias unpreferred, so
-- displays resolved to "United States of America" instead of
-- "United States". This flips preference to the short alias wherever the
-- pair exists; countries with a single English label are untouched.
-- Idempotent: re-running sets the same flags.
UPDATE feastjourney.place_names AS pn
SET is_preferred = (pn.name = s.name)
FROM (
  VALUES
    ('BO', 'Bolivia'),
    ('BN', 'Brunei'),
    ('CV', 'Cape Verde'),
    ('CG', 'Republic of Congo'),
    ('CD', 'Democratic Republic of Congo'),
    ('CI', 'Ivory Coast'),
    ('CZ', 'Czech Republic'),
    ('FK', 'Falkland Islands'),
    ('IR', 'Iran'),
    ('KP', 'North Korea'),
    ('LA', 'Laos'),
    ('MO', 'Macau'),
    ('FM', 'Micronesia'),
    ('MD', 'Moldova'),
    ('PS', 'Palestine'),
    ('RU', 'Russia'),
    ('SY', 'Syria'),
    ('TZ', 'Tanzania'),
    ('TL', 'East Timor'),
    ('TR', 'Turkey'),
    ('SZ', 'Swaziland'),
    ('US', 'United States'),
    ('GB', 'United Kingdom'),
    ('VA', 'Vatican City'),
    ('VG', 'British Virgin Islands'),
    ('VI', 'U.S. Virgin Islands')
) AS s(iso, name)
JOIN feastjourney.places AS p ON p.iso3166 = s.iso
WHERE pn.place_id = p.id
  AND pn.language_tag = 'en';
