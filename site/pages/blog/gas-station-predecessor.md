---
title: Gas Station, the Ansible-Based Predecessor of Install Doctor
slug: gas-station-predecessor
date: 2023-02-16 14:00:00
modifiedDate: 2024-02-23 14:00:00
author: Brian Zalewski <brian@megabyte.space>
authorUrl: https://twitter.com/HillBillyHack3r
authorName: Brian Zalewski
authorImageName: brian-zalewski.png
authorDescription: Call me BZ, the tech maestro of Megabyte Labs by day, gym enthusiast, party animal, and ball game champion by night. Always up for a quirky chat about AI, deities, or time-hopping. Plotting world betterment one inspiration at a time.
description: A little bit about the transition of our provisioning system from Ansible to Chezmoi
featuredImage: /gas-station-transition.png
featuredImageAlt: Transition from Gas Station to Install Doctor
tags:
  - ansible
  - open source
  - deprecated
  - installx
  - software.yml
  - gas station
  - chezmoi
---

Embarking on a journey to create a code-driven solution for seamlessly provisioning complete workstations without the need for post-deployment tweaks, we initially turned to Ansible. However, our journey led us to a superior alternative.

### Our Journey Begins with Ansible

[Ansible](https://www.ansible.com/), a widely recognized standard for automation tasks similar to ours, initially seemed like the perfect fit. Our approach of choosing the best software, with a preference for popular options, aligned well with choosing Ansible. Its sophisticated features, such as script idempotence checking and a robust testing framework named [Molecule](https://github.com/ansible-community/molecule) (which we enhanced to support a variety of operating systems including Archlinux, CentOS, Debian, Fedora, macOS, Ubuntu, and Windows, as seen in [this example](https://github.com/megabyte-labs/ansible-androidstudio/tree/master/molecule)), made it our tool of choice for an extended period. Over time, our unique software stack expanded significantly within the Ansible ecosystem.

### Encountering Ansible's Limitations

Despite its strengths, we eventually encountered limitations with Ansible. The most significant was the realization that simpler shell scripts could accomplish our goals more efficiently, reducing the complexity and size of our codebase. Our original endeavor, dubbed [Gas Station](https://github.com/megabyte-labs/gas-station), grew unwieldy with its numerous roles and variables for customization, highlighting the need for a more streamlined approach.

### Transitioning to Chezmoi

Our search for a better solution led us to [Chezmoi](https://www.chezmoi.io/), a tool adept at managing dotfiles with essential features like encryption, templating, and file change detection. The transition to Chezmoi was facilitated by an innovative [`installx`](https://github.com/heymegabyte/install.doctor/blob/master/home/dot_local/bin/executable_installx) script, simplifying cross-OS software installations. This approach, supported by a [`software.yml`](https://github.com/heymegabyte/install.doctor/blob/master/software.yml) file, allowed for concise, effective management of software installations, significantly reducing the complexity of adding new software to our stack.

### The Ease of Chezmoi

In comparison to Ansible, Chezmoi was not only easier to adopt but also enjoyed popularity on GitHub, aligning with our philosophy of choosing highly-regarded software. Its capability to efficiently manage dotfiles—crucial to our project—stood out as particularly valuable, offering a rich array of features for Bash and ZSH configurations.

### Embracing Scripting with Chezmoi

Chezmoi's flexibility further enabled us to incorporate Bash and PowerShell scripts into our workflow, enhancing our ability to manage installations across different operating systems. While we haven't completely phased out Ansible—still finding it useful for certain applications, particularly in SSH deployments for larger server clusters—we've recognized the benefits of simplifying our approach for single devices or smaller groups, often opting for a straightforward Bash script execution method.

### Future Plans with Ansible

Although we're moving towards Chezmoi for most of our needs, we value the contributions we've made using Ansible and plan to share our roles on Ansible Galaxy. For those interested in exploring our Ansible-based solutions, they remain accessible in the `roles/` directory of the [Gas Station](https://github.com/megabyte-labs/Gas-Station/tree/master/roles) project.
