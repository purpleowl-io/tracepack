> Examples for **@purpleowl-io/tracepack** — async-safe contextual logging for Node.js.
# Log Output Destinations

This logger outputs **newline-delimited JSON (NDJSON)**, making it compatible with virtually any log aggregation system.

## Log Format

Every log line is a single JSON object:

```json
{"ts":"2025-01-15T10:23:01.000Z","level":"info","userId":"alex_123","txId":"abc-789","msg":"contact created"}
```

Fields:

| Field | Description |
|-------|-------------|
| `ts` | ISO 8601 timestamp |
| `level` | `debug`, `info`, `warn`, or `error` |
| `userId` | User identifier (from auth middleware) |
| `txId` | Transaction/request ID for correlation |
| `msg` | Log message |
| `args` | Additional arguments (if any) |
| *custom* | Any fields added via `log.addContext()` |

---

## jq (Command Line)

`jq` is the standard tool for processing JSON logs on the command line.

### Pretty Print

```bash
node app.js | jq .
```

### Filter by User

```bash
node app.js | jq 'select(.userId == "alex_123")'
```

### Filter by Transaction ID

```bash
node app.js | jq 'select(.txId == "abc-789")'
```

### Errors Only

```bash
node app.js | jq 'select(.level == "error")'
```

### Extract Specific Fields

```bash
node app.js | jq '{time: .ts, user: .userId, message: .msg}'
```

### Count Errors

```bash
cat app.log | jq -s '[.[] | select(.level == "error")] | length'
```

### Group by User

```bash
cat app.log | jq -s 'group_by(.userId) | map({user: .[0].userId, count: length})'
```

### Filter by Time Range

```bash
cat app.log | jq 'select(.ts >= "2025-01-15T10:00:00" and .ts <= "2025-01-15T11:00:00")'
```

### Search Message Content

```bash
cat app.log | jq 'select(.msg | contains("order"))'
```

---

## ELK / OpenSearch

### Filebeat Configuration

Ship logs directly to Elasticsearch or OpenSearch using Filebeat:

```yaml
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/myapp/*.log
    json.keys_under_root: true
    json.add_error_key: true
    json.message_key: msg

output.elasticsearch:
  hosts: ["localhost:9200"]
  index: "myapp-logs-%{+yyyy.MM.dd}"

setup.template.name: "myapp-logs"
setup.template.pattern: "myapp-logs-*"
```

### Logstash Pipeline

For more complex processing:

```ruby
# logstash.conf
input {
  file {
    path => "/var/log/myapp/*.log"
    codec => json
    start_position => "beginning"
  }
}

filter {
  date {
    match => ["ts", "ISO8601"]
    target => "@timestamp"
  }
  
  mutate {
    rename => { "txId" => "transaction_id" }
    rename => { "userId" => "user_id" }
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "myapp-logs-%{+YYYY.MM.dd}"
  }
}
```

### Index Mapping

Create an explicit mapping for better search performance:

```json
PUT myapp-logs
{
  "mappings": {
    "properties": {
      "ts": { "type": "date" },
      "level": { "type": "keyword" },
      "userId": { "type": "keyword" },
      "txId": { "type": "keyword" },
      "msg": { "type": "text" },
      "orderId": { "type": "keyword" },
      "args": { "type": "object", "enabled": false }
    }
  }
}
```

---

## Datadog

### Datadog Agent Configuration

Configure the Datadog Agent to collect JSON logs:

```yaml
# /etc/datadog-agent/conf.d/myapp.d/conf.yaml
logs:
  - type: file
    path: /var/log/myapp/app.log
    service: myapp
    source: nodejs
    sourcecategory: application

    # Parse JSON logs automatically
    log_processing_rules:
      - type: multi_line
        name: json_logs
        pattern: '^\{'
```

### Log to stdout (Container/Docker)

For containerized apps, Datadog collects stdout automatically:

```yaml
# docker-compose.yml
services:
  app:
    image: myapp
    labels:
      com.datadoghq.ad.logs: '[{"source": "nodejs", "service": "myapp"}]'
```

### Attribute Mapping

Map log fields to Datadog reserved attributes in `datadog.yaml`:

```yaml
logs_config:
  processing_rules:
    - type: attribute_remapper
      name: map_transaction_id
      sources:
        - txId
      target: trace_id
      
    - type: attribute_remapper
      name: map_user_id
      sources:
        - userId
      target: usr.id
```

### Environment Variables

For simpler setups, configure via environment:

```bash
DD_LOGS_ENABLED=true
DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL=true
DD_APM_ENABLED=true
```

---

## GCP Cloud Logging

### Automatic Parsing (stdout)

When running on GCP (Cloud Run, GKE, Compute Engine), JSON written to stdout is automatically parsed:

```bash
node app.js
# Logs appear structured in Cloud Logging automatically
```

GCP recognizes these standard fields:

| Your Field | GCP Mapping |
|------------|-------------|
| `level` | `severity` (if mapped) |
| `msg` | `textPayload` or `jsonPayload.msg` |
| `ts` | `timestamp` |

### Severity Mapping

To map log levels to GCP severity, adjust the logger output:

```javascript
// In your logger emit function, use GCP's severity field:
const gcpSeverity = {
  debug: 'DEBUG',
  info: 'INFO', 
  warn: 'WARNING',
  error: 'ERROR'
};

const entry = {
  severity: gcpSeverity[level],
  // ... rest of fields
};
```

### Cloud Logging Query

Filter logs in Cloud Logging:

```
jsonPayload.userId="alex_123"
jsonPayload.level="error"
jsonPayload.txId="abc-789"
```

---

## AWS CloudWatch Logs

### Stdout on ECS/Fargate

ECS automatically sends stdout to CloudWatch. Just run your app:

```bash
node app.js
```

Configure the log driver in your task definition:

```json
{
  "containerDefinitions": [{
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/myapp",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "app"
      }
    }
  }]
}
```

### CloudWatch Agent (EC2)

For EC2 instances, use the CloudWatch Agent:

```json
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [{
          "file_path": "/var/log/myapp/app.log",
          "log_group_name": "myapp",
          "log_stream_name": "{instance_id}",
          "timestamp_format": "%Y-%m-%dT%H:%M:%S"
        }]
      }
    }
  }
}
```

### CloudWatch Logs Insights Query

Query structured JSON logs:

```sql
fields @timestamp, userId, txId, msg
| filter level = "error"
| filter userId = "alex_123"
| sort @timestamp desc
| limit 100
```

### Metric Filters

Create metrics from log patterns:

```
{ $.level = "error" }
```

---

## Plain File Logs

### Redirect stdout to File

```bash
node app.js > /var/log/myapp/app.log 2>&1
```

### Redirect with Timestamps Preserved

Since logs already have timestamps, simple redirection works:

```bash
node app.js >> /var/log/myapp/app.log 2>&1
```

### Tee: Console and File

Output to both terminal and file:

```bash
node app.js 2>&1 | tee -a /var/log/myapp/app.log
```

### Log Rotation with logrotate

Create `/etc/logrotate.d/myapp`:

```
/var/log/myapp/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

### Systemd Service with Logging

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My Node.js App
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/opt/myapp
ExecStart=/usr/bin/node app.js
StandardOutput=append:/var/log/myapp/app.log
StandardError=append:/var/log/myapp/app.log
Restart=always

[Install]
WantedBy=multi-user.target
```

### PM2 with JSON Logs

If using PM2:

```bash
pm2 start app.js --log /var/log/myapp/app.log --merge-logs --log-type json
```

Or in `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'myapp',
    script: 'app.js',
    out_file: '/var/log/myapp/app.log',
    error_file: '/var/log/myapp/app.log',
    merge_logs: true,
    log_type: 'json'
  }]
};
```

---

## Quick Reference

| Destination | Method |
|-------------|--------|
| **jq** | Pipe stdout directly |
| **ELK/OpenSearch** | Filebeat or Logstash |
| **Datadog** | Datadog Agent with JSON parsing |
| **GCP** | stdout (auto-parsed) |
| **AWS** | CloudWatch Agent or ECS log driver |
| **File** | Redirect stdout, use logrotate |
