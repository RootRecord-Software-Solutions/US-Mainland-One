# AWS Sync (rclone)

Local control directory: /home/rootrecord/.ollama/skills/aws-sync

## Quick start (after the install block has been run)
1. First time only: ./scripts/initial-resync.sh
2. For seamless editing: ./scripts/mount-ec2.sh
   Then edit files under ./mnt/  (maps directly to EC2 /home/ubuntu/)
3. Or periodic true both-ways: ./scripts/bisync.sh
4. Unmount: ./scripts/unmount.sh

Remote name: ec2 (SFTP → 3.139.100.162 as ubuntu, key_file set)
Config file: config/rclone.conf
Logs: logs/
Local mirror of /home/ubuntu: mirror/
