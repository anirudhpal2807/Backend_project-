variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment (staging, prod)"
}

variable "image_uri" {
  type        = string
  description = "Container image URI"
}

variable "rds_instance_class" {
  type    = string
  default = "db.m6g.xlarge"
}

variable "redis_node_type" {
  type    = string
  default = "cache.m6g.large"
}
