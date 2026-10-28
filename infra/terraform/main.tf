terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  backend "s3" {
    bucket         = "amrutam-terraform-state"
    key            = "telemedicine/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "amrutam-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Amrutam Telemedicine Platform"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

module "vpc" {
  source      = "./modules/vpc"
  environment = var.environment
}

module "kms" {
  source      = "./modules/kms"
  environment = var.environment
}

module "ecs" {
  source             = "./modules/ecs"
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  private_subnet_ids = module.vpc.private_subnet_ids
  image_uri          = var.image_uri
}

module "rds" {
  source                     = "./modules/rds"
  environment                = var.environment
  vpc_id                     = module.vpc.vpc_id
  database_subnet_group_name = module.vpc.database_subnet_group_name
  kms_key_arn                = module.kms.database_key_arn
  app_security_group_id      = module.ecs.app_security_group_id
  instance_class             = var.rds_instance_class
}

module "elasticache" {
  source                = "./modules/elasticache"
  environment           = var.environment
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  app_security_group_id = module.ecs.app_security_group_id
  node_type             = var.redis_node_type
}
