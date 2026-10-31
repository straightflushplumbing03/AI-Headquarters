# Sensitive-table least-privilege migration (028)

Migration `028_sensitive_table_least_privilege.sql` hardens five existing tables without changing the public plumbing website or deployment configuration.

## Access model

| Table | anon | authenticated | service_role |
|---|---|---|---|
| `ai_provider_config` | no access | owner/admin only; CRUD | existing backend access retained |
| `external_connectors` | no access | owner/admin only; CRUD | existing backend access retained |
| `ai_execution_logs` | no access | SELECT + INSERT | existing backend access retained |
| `audit_logs` | no access | SELECT + INSERT | existing backend access retained |
| `organization_members` | no access | existing RLS-governed membership operations | existing backend access retained |

The migration removes table-level privileges that bypass RLS controls (including TRUNCATE, TRIGGER, REFERENCES, and MAINTAIN) from the API roles. Credential-table policies use the existing `public.is_org_admin(uuid)` SECURITY DEFINER helper from migration 017.

The migration contains database assertions and fails if anonymous access remains, append-only log grants are broadened, required authenticated reads/inserts are missing, service-role reads are missing, or the admin-only policies were not installed.

## Applying

Review and apply this migration to the intended Supabase project using the normal migration process. It is not automatically applied by this GitHub change. Verify the target project and take a current backup before applying.

After deployment, rerun the grants/policies inspection queries from the security review. Do not paste API keys, JWTs, or credential values into GitHub or chat.

The local migration harness now reapplies migration 028 after its simulated blanket Supabase grants, so the harness does not accidentally undo the least-privilege settings.
