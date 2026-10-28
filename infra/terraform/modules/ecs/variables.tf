variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "image_uri" {
  type        = string
  description = "Docker image URI from GHCR/ECR"
}

variable "api_cpu" {
  type    = number
  default = 1024 # 1 vCPU
}

variable "api_memory" {
  type    = number
  default = 2048 # 2 GB
}

variable "api_min_capacity" {
  type    = number
  default = 3 # Minimum 3 tasks across 3 AZs for 99.95% SLO
}

variable "api_max_capacity" {
  type    = number
  default = 20
}

variable "worker_cpu" {
  type    = number
  default = 512
}

variable "worker_memory" {
  type    = number
  default = 1024
}

variable "worker_min_capacity" {
  type    = number
  default = 2
}

variable "worker_max_capacity" {
  type    = number
  default = 10
}
