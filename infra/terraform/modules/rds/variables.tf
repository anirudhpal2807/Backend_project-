variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "database_subnet_group_name" {
  type = string
}

variable "kms_key_arn" {
  type = string
}

variable "app_security_group_id" {
  type = string
}

variable "instance_class" {
  type    = string
  default = "db.m6g.xlarge"
}

variable "allocated_storage" {
  type    = number
  default = 200
}

variable "max_allocated_storage" {
  type    = number
  default = 1000
}
