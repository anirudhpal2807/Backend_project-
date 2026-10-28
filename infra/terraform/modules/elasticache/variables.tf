variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "app_security_group_id" {
  type = string
}

variable "node_type" {
  type    = string
  default = "cache.m6g.large"
}

variable "num_cache_clusters" {
  type    = number
  default = 2 # Primary + 1 Read Replica in separate AZ
}
