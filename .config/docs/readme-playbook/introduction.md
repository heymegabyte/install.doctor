## Introduction

Welcome to a new way of doing things. Born out of complete paranoia and a relentless pursuit of the best of GitHub Awesome lists, Gas Station aims to add the capability of being able to completely wipe whole networks and restore them on a regular basis. It takes a unique approach to network provisioning because it supports desktop provisioning as a first-class citizen. By default, without much configuration, it is meant to provision and maintain the state of a network that includes development workstations and servers. One type of user that might benefit from this project is a web developer who wants to start saving the state of their desktop as code. Another type of user is one who wants to start hosting RAM-intensive web applications in their home-lab environment to save huge amounts on cloud costs. This project is also meant to be maintainable by a single person. Granted, if you look through our eco-system you will see we are well-equipped for supporting entire teams as well.

Gas Station a collection of Ansible playbooks, configurations, scripts, and roles meant to provision computers and networks with the "best of GitHub". By leveraging Ansible, you can provision your whole network relatively fast in the event of a disaster or scheduled network reset. This project is also intended to increase the security of your network by allowing you to frequently wipe, reinstall, and re-provision your network, bringing it back to its original state. This is done by backing up container storage volumes (like database files and Docker volumes) to encrypted S3 buckets, storing configurations in encrypted git repositories, and leveraging GitHub-sourced power tools to make the job easy-peasy.

This project started from the desire to bring up and maintain fully automated, reproducible developer workstations and server environments in minutes.

Gas Station is:

- Highly configurable - most roles come with optional variables that you can configure to change the behavior of the role
- Highly configured - in-depth research is done to ensure each software component is configured with bash completions, plugins that are well-received by the community, and integrated with other software used in the playbook
- Compatible with all major operating systems (i.e. Windows, Mac OS X, Ubuntu, Fedora, CentOS, Debian, and even Archlinux)
- The product of a team of experts
- An amazing way to learn about developer tools that many would consider to be "the best of GitHub"
- Open to new ideas - feel free to [open an issue]({{ repository.gitlab }}{{ repository.location.issues.gitlab }}) or [contribute]({{ repository.github }}{{ repository.location.contributing.github }}) with a [pull request]({{ repository.github }}{{ repository.location.issues.github }})!
