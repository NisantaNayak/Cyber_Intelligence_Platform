# Raw Data Drop-in (xlsx)

Put your real source exports here as **.xlsx**, one workbook per source,
named exactly as the templates:

- `asset_crowdstrike.xlsx`
- `asset_cmdb.xlsx`
- `asset_qualys.xlsx`
- `asset_forescout.xlsx`
- `user_okta.xlsx`
- `vuln_qualys.xlsx`
- `network_inventory.xlsx`
- `incident_servicenow.xlsx`
- `risk_register.xlsx`

Rules:
- Row 1 = column headers. Use the headers from the generated templates.
  Extra columns are kept (they flow into `source_detail.raw_data`); the
  named columns below are what entity resolution uses.
- One row per record. The **first sheet** of each workbook is read.
- Dates: any ISO string or an Excel date cell works.
- Booleans: `TRUE`/`FALSE` (or true/false) for fields like
  `kev`, `mfa_enrolled`, `compliant`.
- You only need to provide the files you have. Missing files fall back to
  whatever is already in `seed/` (generated or previous).

Pipeline:
```
npm run xlsx:templates   # (re)create any missing templates here
# ... edit the .xlsx files with your data ...
npm run seed:xlsx        # ingest -> transform (entity resolution) -> load
```

`npm run ingest` converts `data/*.xlsx` -> `seed/*.json` (the format the
transform consumes). It does not touch files you didn't provide.

Key fields per source (used for resolution / linking):

**asset_crowdstrike**: device_id, hostname, local_ip, mac, serial_number, platform, os_version, agent_version, last_seen, loaded_at

**asset_cmdb**: ci_id, name, ip, mac_address, serial, ci_class, owned_by, department, environment, loaded_at

**asset_qualys**: qualys_asset_id, dns_name, ip_address, netbios_mac, asset_serial, os, last_scan, loaded_at

**asset_forescout**: endpoint_id, host, ip, mac, serial_no, device_class, compliant, loaded_at

**user_okta**: okta_id, login, email, firstName, lastName, userType, department, manager, mfa_enrolled, status, loaded_at

**vuln_qualys**: finding_id, asset_serial, cve, cvss_base, severity, kev, exploit_available, title, first_detected, loaded_at

**network_inventory**: net_id, name, cidr, zone, member_serial, loaded_at

**incident_servicenow**: incident_id, title, severity, status, affected_serial, opened_at, loaded_at

**risk_register**: risk_id, title, score, category, cve, loaded_at
