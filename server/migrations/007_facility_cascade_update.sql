ALTER TABLE audits
    DROP CONSTRAINT IF EXISTS audits_facility_id_fkey,
    ADD CONSTRAINT audits_facility_id_fkey
        FOREIGN KEY (facility_id)
        REFERENCES facilities(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT;
