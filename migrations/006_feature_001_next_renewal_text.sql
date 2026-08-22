-- next_renewal was typed `date`, but the receipt parser only ever extracts a
-- loosely-formatted string from email text (e.g. "Jul 31, 2026", sometimes
-- without a year at all) - never a validated calendar date. Storing that in a
-- real `date` column silently reformats it to ISO for display and, when the
-- extracted text has no year, lets Postgres guess the current year, which can
-- produce a wrong date with no error. Store the raw extracted string instead.
ALTER TABLE subscriptions ALTER COLUMN next_renewal TYPE text USING next_renewal::text;
ALTER TABLE evidence ALTER COLUMN next_renewal TYPE text USING next_renewal::text;
