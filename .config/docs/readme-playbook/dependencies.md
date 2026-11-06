## Requirements

- **[Python >=3.7](https://www.python.org/)**
- **[Ansible >=2.9](https://www.ansible.com/)**
- Ansible controller should be a macOS/Linux environment (WSL/Docker can be used on Windows)

### Host Requirements

There are Python and Ansible package requirements need to be installed by running the following command (or equivalent) in the root of this repository:

```
pip3 install -r .config/requirements.txt
ansible-galaxy install requirements.yml
```

#### Easier Method of Installing the Host Requirements

You can also run `bash start.sh` if you do not mind development dependencies being installed as well. This method will even handle installing Python 3 and Ansible.

### Operating System

The current support matrix is authoritative. Native Windows remains unsupported; WSL may use a supported Linux cell. macOS and Linux cells remain best-effort until current real-host lifecycle receipts promote them.

### Connection

SSH and Python should be available on managed Unix targets. Native Windows provisioning is not published until its separately signed PowerShell entrypoint has current lifecycle evidence; do not download and evaluate remote PowerShell.

### MAS on Mac OS X

We use [mas](https://github.com/mas-cli/mas) to install apps from the App Store in some of our roles. Sadly, automatically signing into the App Store is not possible on OS X 10.13+ via mas. This is because [mas no longer supports login functionality on OS X 10.13+](https://github.com/mas-cli/mas/issues/164).

There is another caveat with mas. In order to install an application using mas, the application has to have already been added via the App Store GUI. This means that the first time around you will have to install the apps via the App Store GUI so they are associated with your App Store account.
