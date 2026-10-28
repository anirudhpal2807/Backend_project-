# Database Least Privilege Architecture and Role Separation

## 1. Principles of Database Role Segregation

To adhere to HIPAA Security Rule §164.312(a)(1) (Access Control) and Principle of Least Privilege (PoLP), the Amrutam Telemedicine database infrastructure strictly segregates database access across three distinct PostgreSQL roles:

```mermaid
graph TD
    subgraph PostgreSQL["PostgreSQL 16 Instance (telemedicine_db)"]
        MigratorRole["Role: amrutam_migrator<br/>(Full DDL & Migration Permissions)"]
        AppRole["Role: amrutam_app<br/>(DML Only: SELECT, INSERT, UPDATE, DELETE)<br/>DENIED: UPDATE/DELETE on audit_logs"]
        AnalyticsRole["Role: amrutam_analytics<br/>(SELECT Only on analytics_daily_rollups)"]
        
        Tables["Operational Tables<br/>(users, consultations, payments...)"]
        AuditLogs["audit_logs Table<br/>(Append-Only, Trigger Guarded)"]
        RollupTables["analytics_daily_rollups Table"]
    end

    CI_CD["GitHub Actions CD Pipeline"] -->|Executes Migrations| MigratorRole
    API_Worker["Fastify API & BullMQ Workers"] -->|Operational Queries| AppRole
    BI_Dashboard["BI Reporting & Read Replicas"] -->|Analytical Queries| AnalyticsRole

    MigratorRole -->|DDL: CREATE/ALTER/DROP| Tables
    MigratorRole -->|DDL: CREATE/ALTER/DROP| AuditLogs
    MigratorRole -->|DDL: CREATE/ALTER/DROP| RollupTables

    AppRole -->|SELECT, INSERT, UPDATE, DELETE| Tables
    AppRole -->|INSERT, SELECT Only| AuditLogs
    AppRole -->|INSERT, UPDATE (Rollups)| RollupTables

    AnalyticsRole -->|SELECT Only| RollupTables
```

---

## 2. Role Definitions and Grant Scripts

```sql
-- 1. Create Segregated Roles
CREATE ROLE amrutam_migrator WITH LOGIN PASSWORD 'MIGRATOR_SECRET_KMS';
CREATE ROLE amrutam_app WITH LOGIN PASSWORD 'APP_RUNTIME_SECRET_KMS';
CREATE ROLE amrutam_analytics WITH LOGIN PASSWORD 'ANALYTICS_READONLY_SECRET';

-- 2. Schema Permissions
GRANT ALL ON SCHEMA public TO amrutam_migrator;
GRANT USAGE ON SCHEMA public TO amrutam_app;
GRANT USAGE ON SCHEMA public TO amrutam_analytics;

-- 3. Application Role: DML Access Only (No DDL)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO amrutam_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO amrutam_app;

-- Explicitly Revoke UPDATE & DELETE on audit_logs
REVOKE UPDATE, DELETE ON TABLE audit_logs FROM amrutam_app;

-- 4. Analytics Role: Read-only Access to Rollups
GRANT SELECT ON TABLE analytics_daily_rollups TO amrutam_analytics;

-- 5. Immutability Trigger Defense-in-Depth
-- Even if a superuser role is used, the trigger raises an uncatchable exception:
-- CREATE TRIGGER trg_protect_audit_logs BEFORE UPDATE OR DELETE ON audit_logs ...
```

---

## 3. Deployment Procedure

1. **Pre-Deployment Migration Phase**:
   - The CD worker assumes `amrutam_migrator` credentials from AWS Secrets Manager.
   - Executes `node-pg-migrate up`.
   - Disconnects immediately after migrations succeed.
2. **Runtime Execution Phase**:
   - ECS Fargate containers (API and Worker) inject `amrutam_app` credentials.
   - The application pool has zero privileges to create, alter, or truncate tables.
