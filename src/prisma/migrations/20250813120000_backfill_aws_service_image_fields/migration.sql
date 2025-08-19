WITH logs AS (
    SELECT
        "id",
        details,
        (details->'info'->>'description') AS description
    FROM "AuditLog"
    WHERE action IN ('aws:service:update', 'aws:service:updated')
      AND details->'info'->>'description' IS NOT NULL
)
UPDATE "AuditLog" AS a
SET details = jsonb_set(
    a.details,
    '{info}',
    COALESCE(a.details->'info', '{}'::jsonb)
    || jsonb_strip_nulls(
        jsonb_build_object(
            'service', COALESCE(a.details->'info'->>'service', substring(c.description from 'Service\s+([^\s]+)')),
            'cluster', COALESCE(a.details->'info'->>'cluster', substring(c.description from 'in\s+cluster\s+([^\s]+)')),
            'newServiceImage', COALESCE(
                a.details->'info'->>'newServiceImage',
                (regexp_match(c.description, 'from\s+image\s+([^\s]+)\s+to\s+([^\s]+)$'))[2],
                substring(c.description from 'updated\s+to\s+new\s+image\s+(.+)$')
            ),
            'oldServiceImage', COALESCE(
                a.details->'info'->>'oldServiceImage',
                (regexp_match(c.description, 'from\s+image\s+([^\s]+)\s+to\s+([^\s]+)$'))[1]
            )
        )
    ),
    true
)
FROM logs c
WHERE a.id = c.id;


