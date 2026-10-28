resource "aws_security_group" "redis" {
  name        = "amrutam-${var.environment}-redis-sg"
  description = "Controls Redis access strictly from ECS application tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from App Tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.app_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "amrutam-${var.environment}-redis-sg"
  }
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "amrutam-${var.environment}-redis-subnets"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_parameter_group" "redis7" {
  name   = "amrutam-${var.environment}-redis7-params"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "volatile-lru"
  }
}

resource "random_password" "redis_auth" {
  length  = 32
  special = false
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "amrutam-${var.environment}-redis"
  description                = "Amrutam ${var.environment} Redis Cluster with automatic failover"
  node_type                  = var.node_type
  num_cache_clusters         = var.num_cache_clusters
  parameter_group_name       = aws_elasticache_parameter_group.redis7.name
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis.id]
  port                       = 6379
  automatic_failover_enabled = true
  multi_az_enabled           = true

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  snapshot_retention_limit = 7
  snapshot_window          = "18:00-19:00"

  tags = {
    Name        = "amrutam-${var.environment}-redis"
    Environment = var.environment
  }
}
