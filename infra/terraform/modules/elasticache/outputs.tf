output "primary_endpoint_address" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "reader_endpoint_address" {
  value = aws_elasticache_replication_group.redis.reader_endpoint_address
}

output "port" {
  value = aws_elasticache_replication_group.redis.port
}

output "security_group_id" {
  value = aws_security_group.redis.id
}

output "auth_token" {
  value     = random_password.redis_auth.result
  sensitive = true
}
