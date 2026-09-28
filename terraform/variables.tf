variable "subscription_id" { type = string }
variable "location" {
  type    = string
  default = "westus3"
}
variable "vm_size" {
  type    = string
  default = "Standard_D2ls_v7"
}
variable "ssh_public_key_path" { type = string }
variable "admin_cidr" {
  type        = string
  description = "Administrator public IPv4 address with /32 suffix"
  validation {
    condition     = can(cidrnetmask(var.admin_cidr)) && can(regex("/32$", var.admin_cidr))
    error_message = "Use your public IPv4 address followed by /32."
  }
}
