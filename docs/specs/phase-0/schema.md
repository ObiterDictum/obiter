# Phase 0 Schema

## Tables

`organisations`

`users`

`sessions`

`audit_logs`

`matters`

`matter_documents`

`document_versions`

`artifacts`

## Required Fields

### organisations

- id
- name
- plan
- created_at

### users

- id
- organisation_id
- email
- name
- role
- created_at

### audit_logs

- id
- organisation_id
- user_id
- entity_type
- entity_id
- action
- metadata_json
- created_at

### matters

- id
- organisation_id
- name
- primary_jurisdiction
- secondary_jurisdictions
- legal_domains
- client_reference
- status
- created_at

### matter_documents

- id
- matter_id
- current_version_id
- logical_key
- deleted_at
- created_at

### document_versions

- id
- matter_document_id
- filename
- file_type
- object_key
- text_object_key
- document_status
- version_number
- content_sha256
- sync_state
- created_at

### artifacts

- id
- matter_id
- document_id
- document_version_id
- artifact_type
- status
- object_key
- created_at
