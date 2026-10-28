output "database_key_arn" {
  value = aws_kms_key.database.arn
}

output "envelope_kek_arn" {
  value = aws_kms_key.envelope_kek.arn
}

output "envelope_kek_alias" {
  value = aws_kms_alias.envelope_kek.name
}
