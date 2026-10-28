resource "aws_kms_key" "database" {
  description             = "KMS CMK for Amrutam ${var.environment} Database Storage & Backups"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "amrutam-${var.environment}-db-key"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "database" {
  name          = "alias/amrutam-${var.environment}-database"
  target_key_id = aws_kms_key.database.key_id
}

resource "aws_kms_key" "envelope_kek" {
  description             = "KMS CMK for Amrutam ${var.environment} Application PHI Envelope Encryption (KEK)"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "amrutam-${var.environment}-phi-kek"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "envelope_kek" {
  name          = "alias/amrutam-${var.environment}-phi-kek"
  target_key_id = aws_kms_key.envelope_kek.key_id
}
