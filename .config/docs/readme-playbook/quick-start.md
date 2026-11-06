## Quick Start

The easiest way to run the entire playbook, outlined in the `main.yml` file, is to run the appropriate command listed below. These commands will run the playbook on the machine you run the command on. This is probably the best way to get your feet wet before you decide to give us a ⭐ and customize the playbook for your own needs. Ideally, this command should be run on the machine that you plan on running Ansible with to provision the other computers on your network. It is only guaranteed to work on fresh installs so testing it out with [Vagrant](https://www.vagrantup.com/) is highly encouraged.

### Vagrant (Recommended)

To test it out with Vagrant, you can run the following commands which will open up an interactive dialog where you can pick which operating system and virtualization provider you wish to test the installation with:

```shell
bash start.sh && task ansible:test:vagrant
```

### macOS/Linux

```shell
curl -fsSL https://app.install.doctor/start | bash
```

### Windows

Native Windows provisioning remains unsupported until the separately signed PowerShell release path has current lifecycle evidence. Use the signed Unix stage zero inside WSL on a supported Linux distribution.

### Qubes

Our playbooks include a specially crafted playbook for Qubes. It will load your VMs with sensible defaults. For more details, check out the [Qubes playbook](https://gitlab.com/megabyte-labs/gas-station/-/blob/master/playbooks/qubes.yml) and [Qubes variables](https://gitlab.com/megabyte-labs/gas-station/-/blob/master/environments/prod/group_vars/qubes). Perhaps most importantly, the "quickstart" [the inventory file](https://gitlab.com/megabyte-labs/gas-station/-/blob/master/environments/prod/inventories/quickstart.yml) details the VM structure that the provisioning script adds to the target system.

To setup Qubes, run the following on a fresh install in dom0:

```shell
curl -fsSL https://app.install.doctor/start | bash
```
