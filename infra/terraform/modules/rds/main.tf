resource "aws_security_group" "rds" {
  name        = "amrutam-${var.environment}-rds-sg"
  description = "Controls access strictly from ECS application tasks to PostgreSQL"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from ECS App Tasks"
    from_port       = 5432
    to_port         = 5432
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
    Name = "amrutam-${var.environment}-rds-sg"
  }
}

resource "aws_db_parameter_group" "pg16" {
  name   = "amrutam-${var.environment}-pg16-params"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # Log queries exceeding 1000ms
  }
}

resource "aws_db_instance" "postgres" {
  identifier                  = "amrutam-${var.environment}-db"
  engine                      = "postgres"
  engine_version              = "16.3"
  instance_class              = var.instance_class
  allocated_storage           = var.allocated_storage
  max_allocated_storage       = var.max_allocated_storage
  storage_type                = "gp3"
  storage_encrypted           = true
  kms_key_id                  = var.kms_key_arn
  multi_az                    = true # Enforces Multi-AZ standby replica (PRD §5.4)
  publicly_accessible         = false
  db_subnet_group_name        = var.database_subnet_group_name
  vpc_security_group_ids      = [aws_security_group.rds.id]
  parameter_group_name        = aws_db_parameter_group.pg16.name
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false

  db_name  = "amrutam_${var.environment}"
  username = "amrutam_master"
  manage_master_user_password = true

  backup_retention_period   = 35 # Continuous backups with 35-day PITR (PRD §5.4)
  backup_window             = "19:00-20:00" # UTC
  maintenance_window        = "sun:20:30-sun:21:30"
  copy_tags_to_snapshot     = true
  deletion_protection       = var.environment == "prod" ? true : false
  skip_final_snapshot       = var.environment == "prod" ? false : true
  final_snapshot_identifier = "amrutam-${var.environment}-final-snapshot"

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = var.kms_key_arn
  performance_insights_retention_period = 7 # 7 days free tier

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = {
    Name        = "amrutam-${var.environment}-db"
    Environment = var.environment
  }
}
