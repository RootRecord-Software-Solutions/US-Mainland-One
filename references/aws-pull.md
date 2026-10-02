# AWS pull (1 minute)

On the mainland host (not OmniBook):

```bash
sudo cp references/aws-git-pull.service references/aws-git-pull.timer /etc/systemd/system/
# Adjust WorkingDirectory if checkout path differs
sudo systemctl daemon-reload
sudo systemctl enable --now aws-git-pull.timer
systemctl list-timers | grep aws-git-pull
```

Auth: deploy key or `credential.helper` on that host. OmniBook only pushes.
