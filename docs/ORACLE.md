# Hosting FlowRide on Oracle Cloud (Always Free)

FlowRide fits comfortably on Oracle's **Always Free** tier. Once set up, every push to `main` that passes the tests deploys itself through GitHub Actions. Nobody needs to log in to the server.

## How much it can handle

Measured on this codebase: release build, behind Caddy, one CPU core, then scaled down to the free VM.

| | FlowRide (new) | Current Netlify site |
|---|---|---|
| First visit, phone | **36 KB** | 209 KB |
| Each page after that | **~1 KB** (app cached on the phone) | n/a |
| "My rides" left open 10 min, nothing changing | **7 tiny checks, < 5 KB** (empty "not modified" replies; checks slow from every 20 s to every 2 min, stop when the screen is off) | n/a |
| Server memory | **~80 MB** Node + ~40 MB Caddy | n/a |
| Release download | **0.35 MB** | n/a |

**Throughput on one core:** about 3,000 page loads a second and 4,500–5,200 API calls a second. The free **VM.Standard.E2.1.Micro** gets a fraction of a core (1/8 OCPU, with short bursts above that), so plan on roughly **200–400 requests a second**.

In practice, a busy Friday with 2,000 people using it in the hour before Jumu'ah is about 20 requests a second on average. That is a few percent of what the free VM can do. Bandwidth is no constraint either: 100,000 first visits is about 3.6 GB.

## Always Free limits that matter

| Resource | Free allowance | FlowRide uses |
|---|---|---|
| AMD VM `VM.Standard.E2.1.Micro` | 2 VMs, each 1/8 OCPU, 1 GB RAM, 50 Mbps | 1 VM |
| Arm VM `VM.Standard.A1.Flex` (alternative) | 2 OCPU + 12 GB total across all A1 VMs | optional: 1 OCPU / 6 GB is plenty |
| Block storage | 200 GB total (boot volume 50 GB) | 1 boot volume |
| Database size | n/a | under 5 MB: data is deleted 7 days after each event |

Free resources must be created in your **home region**. In UK South (London), Arm A1 capacity is often "out of capacity", while the Micro AMD VM is usually available. The setup script works on both.

> **Important: idle reclamation.** Oracle may *stop* Always Free VMs that look idle over 7 days: 95th-percentile CPU under 20%, network under 20%, and (A1 only) memory under 20%. A lightweight site like this will look idle.
> - **Recommended:** upgrade the account to **Pay As You Go**. You still pay nothing while you only use Always Free shapes, and Oracle's guidance is that this lifts idle reclamation. Add a **budget alert** (Billing → Budgets, e.g. £1) so you'd hear about any charge. Check Oracle's Free Tier FAQ for the current wording.
> - Don't run "keep-alive" CPU burners. They waste energy and break the spirit of the free tier.
> - If the VM is stopped, start it again from the console; your data stays on the boot volume.

## One-time setup (about 20 minutes, can be done from a phone browser)

### 1. Create the VM
Oracle Cloud console → **Compute → Instances → Create instance**
- Image: **Canonical Ubuntu 24.04**
- Shape: **VM.Standard.E2.1.Micro** (Always Free eligible). Or Ampere A1 with 1 OCPU / 6 GB if it's available.
- Networking: keep "Assign a public IPv4 address" ticked
- SSH keys: let Oracle generate a pair and **download the private key** (that's your own admin key; keep it safe)
- Create, then note the **Public IP address**

### 2. Open ports 80 and 443
Instance page → Subnet → **Security List → Add Ingress Rules**, adding two rules:
- Source `0.0.0.0/0`, TCP, destination port **80**
- Source `0.0.0.0/0`, TCP, destination port **443**

(The server's own firewall is opened automatically by the setup script.)

### 3. Create a deploy key for GitHub
Open **Cloud Shell** (the `>_` icon at the top of the Oracle console) and run, replacing `IP` with your VM's address:

```bash
ssh-keygen -t ed25519 -N "" -C flowride-deploy -f ~/flowride_deploy
# Allow the deploy key on the VM (uses the admin key you downloaded; upload it to Cloud Shell first)
chmod 600 ~/ssh-key-*.key
cat ~/flowride_deploy.pub | ssh -i ~/ssh-key-*.key ubuntu@IP 'cat >> ~/.ssh/authorized_keys'
cat ~/flowride_deploy                  # → secret OCI_SSH_KEY (copy everything incl. BEGIN/END lines)
ssh-keyscan -t ed25519 IP | cut -d' ' -f2-   # → secret OCI_HOST_KEY
openssl rand -base64 24                # → secret ADMIN_TOKEN (organiser password)
openssl rand -base64 32                # → secret DATA_KEY (phone-number encryption key)
```

Save `ADMIN_TOKEN` in your password manager. Keep `DATA_KEY` safe: without it, stored phone numbers can't be read. That's fine, because they expire within days anyway.

### 4. Add the secrets to GitHub
github.com → **haroonis/FlowRide → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `OCI_HOST` | the VM's public IP |
| `OCI_USER` | `ubuntu` (or `opc` on Oracle Linux) |
| `OCI_SSH_KEY` | private deploy key from step 3 |
| `OCI_HOST_KEY` | output of the `ssh-keyscan` line (recommended: stops impostor servers) |
| `ADMIN_TOKEN` | organiser password (16+ characters) |
| `DATA_KEY` | encryption key |
| `CONTROLLER_NAME` | the organisation responsible for the data, e.g. your mosque or community group |
| `PRIVACY_EMAIL` | contact address for privacy requests |
| `SITE_DOMAIN` | *optional*: e.g. `flowride.example.org` after pointing its DNS A record at the IP. Without it the site lives at `https://<ip-with-dashes>.sslip.io` with a real HTTPS certificate |
| `SECURITY_EMAIL` | *optional*: address for security reports |

Also add a **variable** (Variables tab) `FLOWRIDE_URL` = your site address, so the iPhone and Android apps point at it.

### 5. Deploy
Push to `main` (or merge the pull request). In the **Actions** tab the *Deploy to Oracle Cloud* job then:
1. runs all tests first
2. builds the 0.35 MB release
3. sets up the server on the first run: Node 22, Caddy, firewall, a locked-down service, daily backups (downloads are checksum-verified)
4. switches to the new version and **rolls back automatically** if it doesn't start
5. checks the live site over HTTPS

Until the secrets exist, the job skips itself with a notice, so CI stays green.

## What runs on the server

```
Caddy (ports 80/443): automatic HTTPS via Let's Encrypt, zstd/gzip compression, HTTP/2 and HTTP/3, no access logs
  → Node 22 on 127.0.0.1:3000, runs as user "flowride", memory capped at 256 MB, read-only system, sandboxed
     → SQLite in /var/lib/flowride (owner-only); phone numbers AES-encrypted; daily backup kept 7 days
```

- Logs: `journalctl -u flowride -f` (no personal data is logged)
- Restart: `sudo systemctl restart flowride`
- Releases: `/opt/flowride/releases/` (last 3 kept); `current` points at the live one

## Why GitHub Actions deploys, not Claude directly
This Claude sandbox can only reach approved web addresses (HTTPS through a proxy), so it can't open an SSH connection to your VM. It's also safer this way. The server keys live in GitHub's encrypted secrets, not in a chat, and every deploy is tested, logged and repeatable.

## Afterwards
- Point the old Netlify site at the new one: replace its content with a single `_redirects` line, `/* https://YOUR-SITE/:splat 301`.
- Patching: Ubuntu installs security updates automatically (unattended-upgrades is on by default). Re-run the deploy monthly to pick up Node or Caddy updates by bumping the versions in `deploy/setup-server.sh`.
