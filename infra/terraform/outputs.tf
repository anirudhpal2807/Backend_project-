output "alb_dns_name" {
  description = "Public Application Load Balancer endpoint"
  value       = module.ecs.alb_dns_name
}

output "rds_endpoint" {
  description = "PostgreSQL primary connection endpoint"
  value       = module.rds.endpoint
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis primary replication endpoint"
  value       = module.elasticache.primary_endpoint_address
}

output "kms_envelope_kek_arn" {
  description = "KMS Customer Managed Key ARN for PHI Envelope Encryption"
  value       = module.kms.envelope_kek_arn
}
