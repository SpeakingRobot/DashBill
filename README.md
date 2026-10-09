<div align="center">

# DashBill

**Budget, project and GST invoicing software for Windows.**

Brand it with your own business name and logo. Keeps its books in a database
**you** own — your own free TiDB Cloud cluster, or MySQL on your own machine.

### [⬇️ Download DashBill for Windows](https://github.com/SpeakingRobot/DashBill/releases/download/v1.7.0/DashBill-Setup-1.7.0.exe)

`DashBill-Setup-1.7.0.exe` · 79 MB · Windows 10/11 64-bit

*Install it once; after that it updates itself.*

[Install guide](#1-download-and-install) ·
[First-run setup](#2-first-run-setup) ·
[Build from source](#7-building-from-source) ·
[Troubleshooting](#9-troubleshooting)

</div>

---

## Contents

1. [Download and install](#1-download-and-install)
2. [First-run setup](#2-first-run-setup)
3. [What it does](#3-what-it-does)
4. [How the work flows through the app](#4-how-the-work-flows-through-the-app)
5. [Invoices and GST](#5-invoices-and-gst)
6. [Backups and restoring](#6-backups-and-restoring)
7. [Building from source](#7-building-from-source)
8. [Where everything is stored](#8-where-everything-is-stored)
9. [Troubleshooting](#9-troubleshooting)
10. [How the code is arranged](#10-how-the-code-is-arranged)
11. [Database schema](#11-database-schema)
12. [Keyboard shortcuts](#12-keyboard-shortcuts)
13. [Security](#13-security)
14. [Licence and credits](#14-licence-and-credits)

---

## 1. Download and install

### Requirements

| | |
|---|---|
| Operating system | Windows 10 or 11, **64-bit** |
| Disk space | ~300 MB |
| Anything else to install? | **No.** The installer carries its own runtime and its own PDF engine. |
| Internet | Only if you use TiDB Cloud. With local MySQL, DashBill works fully offline. |

### Download

<!-- DOWNLOAD_LINK — bump the version in both links below on every release -->

### ⬇️ [**Download DashBill-Setup-1.7.0.exe**](https://github.com/SpeakingRobot/DashBill/releases/download/v1.7.0/DashBill-Setup-1.7.0.exe) &nbsp;·&nbsp; 79 MB

That link downloads the installer straight away — there is no page to navigate
and nothing to sign in to. Every version is kept on this repository's
[releases page](https://github.com/SpeakingRobot/DashBill/releases) if you ever need an older one.

**You need exactly one file.** It is completely self-contained: no companion
files, no runtime to install first, nothing to unzip. The `latest.yml` and
`.blockmap` files you will see listed beside it on the releases page are for
the in-app updater, not for you.

From version 1.6.0 onwards DashBill finds and installs its own updates, so this
is the last time you will download it by hand — see
[Installing an update](#installing-an-update).

You can also build the installer yourself from this repository — see
[Building from source](#7-building-from-source).

### Install

1. Double-click **`DashBill-Setup-1.7.0.exe`**.
2. Windows will almost certainly show a blue box:
   **_"Windows protected your PC"_**. This is expected — see below.
3. Choose where to install (the default is fine) and press **Install**.
4. DashBill opens on its start-up screen.

### ⚠️ About the "Windows protected your PC" warning

```
Windows protected your PC
Microsoft Defender SmartScreen prevented an unrecognised app from starting.
```

Click **More info** → **Run anyway**.

This appears because the installer is not code-signed. SmartScreen flags *every*
unsigned application, regardless of what it does. Removing the warning requires
a code-signing certificate bought from a certificate authority (an identity-verified,
paid product, typically renewed yearly). Nothing in the software causes it.

If your browser blocks the download instead, use its "Keep" / "Keep anyway"
option in the downloads list.

### Installing an update

DashBill checks GitHub for a newer version and can install it for you.

**Settings → Updates & news → Check for updates.** If a newer release exists you
get its release notes and a **Download the update** button. When the download
finishes, **Close and install now** shuts the app, runs the installer and
reopens it.

**Nothing of yours is touched by an update.** The installer replaces the program
files in `%LOCALAPPDATA%\Programs\DashBill` and nothing else:

| Yours | Where it lives | Survives an update? |
|---|---|---|
| Your books — clients, projects, income, expenses, invoices | Your own database | ✅ never on this machine at all |
| Your database login | `%APPDATA%\DashBill\config.json` | ✅ outside the program folder |
| Your logo, signature, invoice numbering, every setting | Your own database | ✅ |
| Backup folder and schedule | `config.json` | ✅ |
| Window size and position | `config.json` | ✅ |

New database columns are applied automatically on first launch, so an update
never needs anything from you afterwards.

A check happens once quietly at start-up — just a version number and the notes,
never a download. Switch that off on the same screen if you would rather check
by hand. You can also install by hand at any time: download the new
`DashBill-Setup-<version>.exe` and run it over the top of the old install.

### Release notes and messages

The same screen shows the release notes for every version, and short messages
posted by whoever maintains your copy of the software — "version 1.7 is out",
"this cluster region is faster", and so on. Unread ones put a red dot on
**Settings** in the sidebar, and reading the page clears it.

### Uninstalling

**Settings → Apps → Installed apps → DashBill → Uninstall.** This removes the
program only. Your database and your backup files are left alone; delete those
yourself if you want them gone.

---

## 2. First-run setup

The first launch asks two things: where to keep your books, and whose business
this is. It takes about three minutes and never asks again.

### Step 1 — Where your data lives

#### Option A — TiDB Cloud (recommended)

TiDB Cloud is a MySQL-compatible database that runs online. The free Serverless
tier holds many years of billing data comfortably, and because the data is not
tied to one machine you can install DashBill on a second computer and see the
same books.

1. Sign up at **[tidbcloud.com](https://tidbcloud.com/)** — free, no card needed.
2. Create a **Serverless** cluster. Pick the region nearest to you.
3. Open the cluster and press **Connect**.
4. Under *Connect With*, choose **General**.
5. If you have not set a password yet, press **Generate Password**.
   **⚠️ Copy it somewhere safe — it is shown only once.**
6. Copy the whole connection string. It looks like this:

   ```
   mysql://xxxxxxxxxxx.root:yourpassword@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/test
   ```

7. In DashBill, choose **TiDB Cloud**, paste that string into the box, and press
   **Fill in the form from this**. Every field fills itself in.
8. Press **Connect and set up**.

The database and all eleven tables are created for you.

> TiDB Cloud accepts encrypted connections only, so **Use a secure connection
> (TLS)** is switched on automatically and cannot be turned off for those hosts.
> There is no certificate file to download.

#### Option B — MySQL on this computer

Choose this if the data must never leave the machine.

1. Install **MySQL Community Server 8** from
   [dev.mysql.com/downloads/mysql](https://dev.mysql.com/downloads/mysql/).
   MariaDB works too.
2. During setup tick **Configure MySQL Server as a Windows Service** and
   **Start the service at System Startup**, and set a root password you will
   remember.
3. Confirm the service is running: press <kbd>Win</kbd>+<kbd>R</kbd>, type
   `services.msc`, find **MySQL80**, and start it if it is stopped.
4. In DashBill choose **MySQL on this computer**, leave the host as `127.0.0.1`
   and the port as `3306`, enter `root` with your root password, and press
   **Connect and set up**.

> With this option **your backups are your only protection.** If the machine
> dies and there is no copy elsewhere, the data is gone. Put the backup folder
> on a pen drive, an external disk or a synced folder — see
> [Backups](#6-backups-and-restoring).

#### Changing it later

**Settings → Database** has the same form, including the paste box. To move
between the two: take a backup, point DashBill at the other server, restore the
backup into it.

### Step 2 — Make it yours

Once connected, DashBill asks for:

- **Your business name** — appears in the sidebar, in the window title and on
  every invoice.
- **Tagline** — optional, printed small under your name on the invoice.
- **Your logo** — PNG, JPG, SVG or WebP under 1 MB. A square mark around
  600×600 prints crisply. It is stored *inside your database*, so it travels
  with your backups, and it goes straight onto your invoices.
- **Invoice prefix** — suggested from your initials; you will see a preview of
  your first invoice number.
- **What to call the software** — it defaults to *DashBill*, and you can rename
  it. This is your copy.

Everything here is editable later under **Settings → Company profile**, and you
can press **Skip for now** to deal with it afterwards.

### Step 3 — Finish your profile

Go to **Settings → Company profile** and fill in your address, phone, email,
GSTIN, PAN and bank details. All of it prints on your invoices. Then check
**Settings → Invoice defaults** for your numbering format, default GST rate and
payment terms.

> **GST:** leave the GSTIN blank and new invoices carry **no GST**. Fill a GSTIN
> in and new invoices apply GST automatically as a single combined line at your
> default rate — 18% suits most commercial work. Set the default in Settings to
> one of the split forms instead and new invoices will choose CGST + SGST for a
> client in your state and IGST for one elsewhere. You can override it on any
> individual invoice.

---

## 3. What it does

**Dashboard** — the month at a glance: income, expenses, net, and what clients
still owe you. Overdue invoices, completed jobs waiting to be paid, recurring
payments falling due, and a twelve-month income-versus-expenses chart.

**Income** — every rupee that came in. Type in a one-off amount, or let it
arrive by itself when you mark a project paid or record an invoice payment. Each
entry can be tied to a client and a project, so you can always see which client
brought in how much business.

**Expenses** — what went out, with categories that mean something: materials,
business running costs, reinvestment, loans, subscriptions, tax, and personal
spending kept separately so the business figures stay readable. A **Recurring**
tab handles rent, salaries, subscriptions and EMIs — including a loan balance
that counts down as you record each instalment.

**Projects** — the jobs in hand, with the agreed amount and a deadline. A
project moves `Planned → In progress → Submitted → Completed`, and only once the
client has actually paid do you mark it **Paid** — which writes the income entry
for you. Part payments and advances can be recorded at any stage. Costs can be
tagged to a project so you can see what a job really earned.

**Invoices** — pick a completed project and the line items fill themselves in,
or build one from scratch. Choose your own columns, apply GST however you need
it, preview the exact PDF, then save or print it. Recording a payment updates
the invoice, the project and the income ledger in one action.

**Clients** — register a client once and they appear in every dropdown from then
on, with running totals of what they have paid and what they still owe.

**Reports** — income and expenses for any period, by client and by category,
plus a GST summary for filing time. Everything exports to CSV for your
accountant.

**Deadlines that speak up** — anything overdue or due within a week is called
out on Projects, on the dashboard and on the welcome screen, and the Deadline
column counts down in red. Projects has three tabs across the top with live
counts: **Pending**, **Just started** and **Completed**.

**Your signature on the bill** — upload a transparent PNG once under
**Settings → Company profile → Signature** and it prints on the signature line
above *Authorised Signatory* on every invoice, so you never have to print a bill
just to sign it.

**A tutorial built into the software** — **Settings → Help & tutorial** has a
guided run-through of each part of the app and written answers to the questions
people actually ask. It walks your real screens rather than showing pictures of
somebody else's. The **?** in the top bar (or <kbd>F1</kbd>) runs through
whichever page you are looking at.

**Updates and messages** — **Settings → Updates & news** finds new versions on
GitHub, shows what changed and installs them without touching anything of
yours. See [Installing an update](#installing-an-update).

**Made to be read** — nothing in the software is printed smaller than 12px, and
every piece of text clears the WCAG AA contrast floor against the background it
is actually drawn on. If that is still not big enough, **Settings → Company
profile → Display size** enlarges the whole window — text, buttons and spacing
together — up to 150%, and remembers it. <kbd>Ctrl</kbd>+<kbd>+</kbd> and
<kbd>Ctrl</kbd>+<kbd>0</kbd> do the same from anywhere. It changes nothing on
the rest of the computer and nothing on a printed invoice.

---

## 4. How the work flows through the app

Record each fact once, where it happens, and the other screens follow.

```
1. Clients     →  register the client (once)
2. Projects    →  add the project: title, client, agreed amount, deadline
3. Projects    →  "Start work"  →  "Mark submitted"  →  "Mark completed"
4. Invoices    →  the app offers to raise the invoice; line items are filled in
5. Invoices    →  "Record payment" when the money arrives
                     ↓
                  the invoice is marked paid
                  the project is marked paid
                  an income entry appears in the Income ledger
```

**Completion and payment are deliberately separate.** Finishing a job is not the
same as being paid for it, so DashBill will not let you mark a project paid
until it is marked completed. The dashboard then lists everything *done but not
yet paid* — that is your chase list.

An advance or part payment can be recorded at any stage with **Record payment**;
the project shows as *Part paid* and the balance is tracked.

**Money with no project behind it:** in **Income → Add income** you can enter an
amount with just a client, or with no client at all — in which case a
description is required, so no entry is ever left unexplained.

**One source of truth.** A project's paid/unpaid state is always recalculated
from the income entries attached to it, never stored separately. However money
is recorded — on the project, through an invoice, or typed into the ledger — the
project, the invoice and the ledger always agree. Removing a payment unwinds all
three.

---

## 5. Invoices and GST

**Invoices → New invoice** has two tabs: *Invoice details* and *Preview the
PDF*. The preview is the real document, rendered by the same engine that writes
the file, so what you see is exactly what the client gets.

### Choosing your columns

Only **item/service**, **rate** and **amount** are fixed. Everything else is up
to the job, from the toggles above the line-item table:

- **Qty** is on by default. Switch it off for a flat-price bill and every line
  is simply priced as one.
- **HSN/SAC** and **Unit** are off, so an unused column never prints as an empty
  strip down the page. Tick them when a client needs them.
- **+ Column** adds a column of your own — Size, Colour, Finish, anything — with
  a value you fill in per line. Up to four, each removable.

The choice is saved with that invoice, so a bill you reopen a year later still
prints exactly as it was sent.

### The arithmetic

```
subtotal   = Σ (quantity × rate)      -- qty is 1 when the column is off
discount   = % of subtotal, or a flat amount
taxable    = subtotal − discount
GST        = taxable × rate           -- one line, or split 50/50 into
                                         CGST + SGST, or charged whole as IGST
total      = taxable + GST + delivery, optionally rounded to the nearest rupee
```

Totals are always recalculated inside the application before saving. The figures
sent by the screen are never trusted.

| Field | What it does |
|---|---|
| Invoice number | Auto-generated from your format; you can type your own |
| Client | Fills the billed-to block from the client record |
| Against project | Drops the project title and amount into the first line |
| GST treatment | No GST / one combined GST line / CGST + SGST / IGST, with 0 · 5 · 12 · 18 · 28 % shortcuts |
| Discount | A percentage of the subtotal, or a flat amount |
| Delivery charge | Added after tax |
| Round off | Rounds the total to the nearest rupee and shows the adjustment |
| Notes | Printed above the payment details |
| Payment details | Starts from your company profile, editable per invoice |

### The PDF

A single A4 page with your logo, both addresses, both GSTINs, the line-item
table, the tax breakdown, the amount in words in the Indian system
("Rupees Twelve Lakh Thirty Four Thousand…"), your notes, your bank details,
your terms and a signature block. Monochrome by design: it photocopies cleanly
and costs nothing in colour ink.

**Save PDF** writes the file; **Print** opens the Windows print dialog;
**Duplicate** copies an invoice as a fresh draft with the next number.

An invoice freezes the client's name, address and GSTIN onto itself when saved,
so editing a client years later never changes a bill you already sent.

---

## 6. Backups and restoring

A backup is a plain `.sql` file containing the whole database — schema and data.
DashBill writes them itself; `mysqldump` is not required.

- **Automatically** every 15 days (configurable), and again each time you close
  the app.
- **Manually** with <kbd>Ctrl</kbd>+<kbd>B</kbd>, or **Settings → Backups →
  Back up now**.
- Old copies are pruned, keeping the most recent 24 by default.

Default location:

```
C:\Users\<you>\Documents\DashBill Backups\
```

**Change this to somewhere that survives the computer** — a pen drive, an
external disk, or a OneDrive / Google Drive folder. *Settings → Backups →
Change.*

### Restoring

**Settings → Backups** lists every backup with a **Restore** button. Restoring
replaces everything currently in the database; a safety copy of the present data
is taken first into a `before-restore` subfolder, so it can be undone.

Because the file is ordinary SQL you are never locked in. Restore it from the
command line onto any MySQL-compatible server:

```bash
mysql -u root -p dashbill < dashbill-2026-10-08_012433.sql
```

That is also how you move from TiDB Cloud onto a local MySQL server, or onto a
new computer.

### CSV for the accountant

**Settings → Backups → Export CSV ledgers**, or the **Export CSV** button on
Income, Expenses, Invoices and Reports, writes spreadsheet files for the income
ledger, the expense ledger, the invoice list and the project list. They open
directly in Excel.

---

## 7. Building from source

### Prerequisites

| | |
|---|---|
| [Node.js](https://nodejs.org/) | 20 or newer (`node -v` to check) |
| [Git](https://git-scm.com/) | any recent version |
| Windows | 10 or 11, 64-bit |
| Free disk space | ~1.5 GB during the build |

### Steps

```bash
git clone https://github.com/<owner>/dashbill.git
cd dashbill
npm install
```

Run it in development, with developer tools open:

```bash
npm run dev
```

Run it exactly as a user would:

```bash
npm start
```

Build the distributable Windows installer:

```bash
npm run dist
```

That produces:

```
dist\DashBill-Setup-1.7.0.exe
```

**That single file is what you publish.** See
[what to share](#what-the-dist-folder-contains) below.

To build an unpacked folder instead of an installer (faster, for testing):

```bash
npm run pack
```

### What the `dist` folder contains

After `npm run dist` you get several things. Two of them go in the release.

| File / folder | What it is | Upload it? |
|---|---|---|
| **`DashBill-Setup-<version>.exe`** | The installer. Completely self-contained. | ✅ **Yes** |
| **`latest.yml`** | Version number, file name and SHA-512 of that installer. Without it, installed copies can find the release but cannot verify or install it. | ✅ **Yes** |
| `DashBill-Setup-<version>.exe.blockmap` | Lets an update download only the parts that changed. | ✅ Yes, if you want smaller updates |
| `win-unpacked/` | The loose build the installer was packed from (~75 files, 271 MB). `DashBill.exe` inside it only runs if the whole folder is beside it. | ❌ No |
| `builder-debug.yml` | Build diagnostics. | ❌ No |

### Releasing a new version

In-app updating works off **GitHub Releases**, and so does the download link in
this README. GitHub hosts the installer itself, with no size limit to worry
about and no separate file-sharing account to keep in step — the release is the
single place a version lives.

1. **Bump the version.** Edit `version` in `package.json` — `1.6.1` → `1.7.0`.
   This is the number the updater compares, so it must go up.
2. **Build.** `npm run dist`.
3. **Cut the release.** On GitHub: **Releases → Draft a new release**.
   - Tag: `v1.7.0` (the leading `v` is fine, it is stripped when comparing).
   - Title: something a person would read — "Signatures and the tutorial".
   - Body: the release notes. Plain text with `-` bullets, `**bold**` and
     `` `code` `` is all DashBill renders; anything else shows as text.
   - Attach `DashBill-Setup-1.7.0.exe`, `latest.yml` and the `.blockmap`.
   - Leave **Set as a pre-release** unticked — pre-releases are ignored.
4. **Publish.** Every installed copy sees it within half an hour, or at once if
   someone presses Check for updates.
5. **Update the two download links in this README** — the one under the title
   and the one in [Download](#download). Both name the version, so both move.
   Search for `DOWNLOAD_LINK` to find the second.

With the GitHub CLI the last two steps are one command:

```bash
gh release create v1.7.0 "dist/DashBill-Setup-1.7.0.exe" "dist/latest.yml" "dist/DashBill-Setup-1.7.0.exe.blockmap" --title "Easier to read" --notes-file notes.md
```

Schema changes apply automatically: `src/main/schema.sql` runs on every start-up
and every statement in it is safe to re-run, while columns added after a release
are applied to existing databases by the migration list in `src/main/db.js`.

**Why not build on the user's machine?** Because it would mean shipping Node,
npm, electron-builder and about a gigabyte of toolchain to every user, and
asking a printer in Mapusa to run a build. The installer *is* the build, made
once here; the app fetches it and verifies its SHA-512 before running anything.

### Posting a message without cutting a release

`admin/` holds a separate little application — the **Notice Publisher** — for
posting short messages that every installed copy shows under
**Settings → Updates & news**. It is not part of the product: it is excluded
from git, is never published, and exists only on your machine.

```bash
npm run admin
```

It writes to `notices.json` in this repository through the GitHub API, so every
install sees the message within half an hour. It needs a **fine-grained**
personal access token with **Contents: write** on this repository and nothing
else. `admin/README.md` has the details.

Anything posted that way is **public**, because this repository is public.

---

## 8. Where everything is stored

| What | Where |
|---|---|
| Your data | The database you chose during setup |
| Connection details and preferences | `%APPDATA%\DashBill\config.json` |
| Backups | The folder shown in Settings → Backups |
| The application | `%LOCALAPPDATA%\Programs\dashbill` (or wherever you installed it) |
| Your logo | Inside the database, so it travels with the backups |

**Settings → Backups** shows all of these paths on screen.

DashBill talks to your database and to nothing else. No vendor account, no
telemetry, no third-party service.

---

## 9. Troubleshooting

### Installing and running

<details>
<summary><b>"Windows protected your PC" when running the installer</b></summary>

Expected — the installer is unsigned. Click **More info** → **Run anyway**.
Removing the warning permanently requires a paid code-signing certificate.
</details>

<details>
<summary><b>The browser refuses to download the .exe</b></summary>

Chrome and Edge often block unsigned executables. Open the downloads list
(<kbd>Ctrl</kbd>+<kbd>J</kbd>), find the file, and choose **Keep** /
**Keep anyway**.
</details>

<details>
<summary><b>Antivirus quarantines the installer</b></summary>

Unsigned Electron installers are a common false positive. Restore the file from
quarantine and add an exclusion, or build it yourself from source
([section 7](#7-building-from-source)) so you know exactly what is in it.
</details>

<details>
<summary><b>The app opens on the setup screen even though it worked yesterday</b></summary>

It could not reach the database. The error and a plain-language hint appear at
the top of that screen, and the details you used are already filled in — correct
them and press **Connect**. The usual causes are a changed password, no internet
(TiDB Cloud), or a stopped MySQL service (local).
</details>

<details>
<summary><b>The window is blank or will not start</b></summary>

Close it completely (check Task Manager for a stray **DashBill** process), then
reopen. If it persists, rename `%APPDATA%\DashBill\config.json` and start again —
you will be asked for the database details once more, and no data is lost.
</details>

### Connecting to the database

<details>
<summary><b>"Connections using insecure transport are prohibited"</b></summary>

Your server requires TLS. Tick **Use a secure connection (TLS)**. For
`*.tidbcloud.com` hosts it is forced on automatically, so this should not appear.
</details>

<details>
<summary><b>"The user name or password was rejected"</b></summary>

On TiDB Cloud the user name includes the cluster prefix, like
`1a2b3c4d5e.root` — copy it exactly from the **Connect** dialog. If the password
is lost, generate a new one there and update **Settings → Database**.

The quickest fix is to paste the whole connection string again and press
**Fill in the form from this**.
</details>

<details>
<summary><b>"That host name could not be found"</b></summary>

A typo in the host, or no internet connection. A TiDB host looks like
`gateway01.<region>.prod.aws.tidbcloud.com`.
</details>

<details>
<summary><b>"The server did not answer in time"</b></summary>

Check your internet connection. A Serverless cluster that has been idle takes a
moment to wake — press **Connect** again. Also check that your network does not
block outbound port 4000.
</details>

<details>
<summary><b>"Nothing is listening on that host and port" (local MySQL)</b></summary>

The MySQL service is not running. <kbd>Win</kbd>+<kbd>R</kbd> → `services.msc` →
**MySQL80** → **Start**. Set its startup type to *Automatic* so it comes up with
Windows.
</details>

### Building from source

<details>
<summary><b>"Electron failed to install correctly, please delete node_modules/electron and try installing again"</b></summary>

`npm install` downloaded the Electron package but its binary never unpacked.
Finish the job by hand:

```bash
node node_modules/electron/install.js
```

If that exits silently without downloading, the zip is already cached and only
the extraction failed. Extract it yourself:

```bash
# find the cached zip
ls "$LOCALAPPDATA/electron/Cache"
```

then unzip `electron-v<version>-win32-x64.zip` into
`node_modules/electron/dist/`, and create `node_modules/electron/path.txt`
containing the single line `electron.exe`.
</details>

<details>
<summary><b><code>npm run dist</code> fails with "Cannot create symbolic link"</b></summary>

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
       ...winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
```

electron-builder downloads a code-signing bundle containing macOS symlinks, and
Windows refuses to create symlinks without elevated rights. The macOS files are
irrelevant to a Windows build. Either:

- turn on **Settings → System → For developers → Developer Mode**, which permits
  symlinks, and run `npm run dist` again; **or**
- unpack the bundle yourself, skipping the macOS folder:

  ```bash
  CACHE="$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
  ./node_modules/7zip-bin/win/x64/7za.exe x "$CACHE"/*.7z \
      "-o$CACHE/winCodeSign-2.6.0" '-xr!darwin'
  ```

  then run `npm run dist` again — it will use what it finds.
</details>

<details>
<summary><b>The built app shows the default Electron icon</b></summary>

`build/icon.ico` is missing. It ships with the repository; if it has been
deleted, put any multi-size `.ico` there and rebuild. To use your own icon,
replace that file — the app icon is fixed at build time, unlike your business
logo, which is set per install and lives in the database.
</details>

<details>
<summary><b><code>npm install</code> fails behind a corporate proxy or VPN</b></summary>

Electron and electron-builder fetch binaries from GitHub releases. Configure
npm's proxy settings, or run the install off the VPN.
</details>

### Using it

<details>
<summary><b>"Mark the project as Completed first, then mark it paid"</b></summary>

That is the intended workflow. For an advance or part payment use **Record
payment** instead, which works at any stage.
</details>

<details>
<summary><b>"This entry was created by an invoice payment"</b></summary>

Income created by an invoice is edited from the invoice, so the two cannot
disagree. Open the invoice and change the payment there.
</details>

<details>
<summary><b>A project or invoice will not delete</b></summary>

Records with money attached cannot be deleted, because that would silently
change your totals. Set the project to *Cancelled* or the invoice to
*Cancelled* instead — the invoice number stays in sequence, which is what an
auditor expects.
</details>

---

## 10. How the code is arranged

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron 33** | A genuine Windows `.exe`, not a website. One build, no runtime for the user to install, and it brings a PDF engine with it. |
| Database | **MySQL protocol** (TiDB Cloud, or local MySQL/MariaDB) | Proper SQL with foreign keys and transactions, so the books cannot drift out of step. TiDB speaks the MySQL protocol, which is why one driver serves both. |
| Driver | **mysql2** | Pure JavaScript — no native compilation, so the build is reliable. Supports TLS, prepared statements and streaming. |
| Interface | Plain HTML, CSS and JavaScript | No framework and no build step for the UI. Less to go wrong, and still readable in five years. |
| PDF | Chromium's own print engine | The invoice is laid out in HTML and printed by the same engine as Chrome's <kbd>Ctrl</kbd>+<kbd>P</kbd>. No external tool, no font packs. |
| Backups | A dump writer in JavaScript | Backups must not depend on `mysqldump.exe` being installed — the whole point of the file is that it still works on another machine. |

**Exactly one runtime dependency:** `mysql2`. Everything else is the platform.

```
src/
  main/                      the Node side; it alone touches the database
    main.js                  window, splash screen, menu, backup timer
    preload.js               the only bridge to the window (one function)
    db.js                    connection pool, TLS, schema bootstrap, migrations
    config.js                config.json in the user's AppData folder
    schema.sql               every table; safe to re-run
    ipc/                     one module per feature area
      app, settings, clients, projects, income, expenses,
      invoices, dashboard, backup
    services/
      invoiceMath.js         the money arithmetic and column rules
      invoiceTemplate.js     the invoice as HTML
      pdf.js                 HTML → PDF
      numbering.js           invoice numbering
      dump.js                backup writer and restorer
      connectionString.js    parses a pasted mysql:// string
      projectPayments.js     keeps a project in step with the income ledger
      backupRunner.js        the backup schedule
      util.js                money, dates, amount-in-words
  renderer/                  the window; no database access, no filesystem
    index.html, splash.html, styles.css, app.js
    lib/ui.js                tables, modals, forms, charts, formatting
    pages/                   dashboard, income, expenses, projects,
                             invoices, clients, reports, settings
```

The window runs with `contextIsolation` on, `nodeIntegration` off and a strict
Content-Security-Policy. It cannot reach the filesystem or the database; it can
only call the named handlers in `src/main/ipc`. Every amount is recalculated on
the Node side before it is stored.

---

## 11. Database schema

Eleven tables. `src/main/schema.sql` is the authority.

| Table | Holds |
|---|---|
| `clients` | Name, company, contact, GSTIN, PAN, billing address |
| `projects` | Title, client, agreed amount, status, payment status, deadline |
| `incomes` | Every payment received, with its client, project and invoice links |
| `expense_categories` | Category name plus its *kind* (business, materials, reinvestment, loan, subscription, personal, tax, other) |
| `expenses` | One-off spends, optionally tagged to a project |
| `recurring_expenses` | Rent, salaries, subscriptions, EMIs; schedule, next due date, loan balance |
| `invoices` | Invoice header: numbers, dates, frozen addresses, tax, every money figure, the column choice, per-invoice payment details |
| `invoice_items` | Line items: description, HSN/SAC, quantity, unit, rate, amount, custom column values |
| `invoice_payments` | Payments against an invoice, each linked to its income entry |
| `app_settings` | Branding, company profile, bank details, logo, invoice defaults |
| `activity_log` | What happened and when; feeds the dashboard activity strip |

Money is `DECIMAL(14,2)` throughout — never floating point. Foreign keys use
`ON DELETE SET NULL` for links to clients and projects, so deleting a client
never destroys the money history: the entries remain, they simply stop being
linked.

---

## 12. Keyboard shortcuts

| | |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>N</kbd> | New invoice |
| <kbd>Ctrl</kbd>+<kbd>I</kbd> | New income entry |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> | New expense |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | New project |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | New client |
| <kbd>Ctrl</kbd>+<kbd>B</kbd> | Back up now |
| <kbd>Ctrl</kbd>+<kbd>,</kbd> | Settings |
| <kbd>F1</kbd> | Run through the page you are on |
| <kbd>Ctrl</kbd>+<kbd>+</kbd> / <kbd>Ctrl</kbd>+<kbd>-</kbd> | Bigger / smaller text |
| <kbd>Ctrl</kbd>+<kbd>0</kbd> | Back to the normal text size |
| <kbd>F5</kbd> | Refresh the current page |
| <kbd>Alt</kbd>+<kbd>1</kbd> … <kbd>Alt</kbd>+<kbd>7</kbd> | Jump between tabs |

---

## 13. Security

- **The installer contains no credentials.** Each install stores its own in
  `%APPDATA%\DashBill\config.json`, readable only by that Windows user, and
  sends them nowhere except to your own database server.
- Connections to hosted databases use **TLS 1.2 or better with full certificate
  verification**.
- The window cannot reach the filesystem or the database. It communicates
  through a single allow-listed bridge and runs under a Content-Security-Policy
  that blocks all network access from the page itself.
- Every value written to the database goes through a parameterised query.
- **Updates** are fetched only from `github.com` and `raw.githubusercontent.com`
  over HTTPS; a redirect anywhere else is refused. The installer's SHA-512 is
  checked against the signed release metadata before it is run, and nothing is
  ever downloaded or installed without you pressing a button for it.
- Release notes and messages fetched from GitHub are **data**. They are shown as
  text, can never introduce markup or a link target, and cannot tell the
  software to do anything.
- The admin **Notice Publisher** holds a GitHub token in plain text in its own
  data folder. Use a **fine-grained** token limited to this one repository with
  **Contents: write** and an expiry date, and press **Forget token** on any
  machine you do not control.
- **If a connection string has ever been shared — in a chat, an email, a
  screenshot or a support ticket — treat the password as compromised and rotate
  it.** In TiDB Cloud: open the cluster → **Connect** → generate a new password,
  then update **Settings → Database**. Anyone holding that string can read and
  change everything in the cluster.

---

## 14. Licence and credits

**DashBill** — built by **Samuel Fernandes**.

Any business can install it, point it at their own database, and put their own
name and logo on it.

© 2026 Samuel Fernandes. All rights reserved.
