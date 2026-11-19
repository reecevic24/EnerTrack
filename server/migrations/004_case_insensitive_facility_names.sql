CREATE UNIQUE INDEX facilities_display_name_lower_unique
    ON facilities (lower(display_name));
