# Shop & Salon Manual
:kicker: Institution Type Guide
:subtitle: Running a salon, barbershop, or retail shop on the attendance system
:audience: Shop owners, managers, and cashiers
:version: Version 2.0  |  August 2026
:footer: ESP32 Fingerprint Attendance System

<<<TOC>>>

## 1. What the system does for a shop

A shop-type account does two separate jobs. They share one login and one dashboard, but they do not depend on each other -- you can use either half on its own.

| Half | What it covers | How records are created |
| --- | --- | --- |
| **Staff attendance** | Your own employees -- stylists, barbers, sales assistants | Fingerprint scan at the device |
| **Retail** | Your customers, sales, stock, and loyalty | Typed into the dashboard by a cashier or manager |

> [!NOTE] Customers never touch the fingerprint scanner. Only your employees are enrolled on the device. A customer's visit is recorded when a cashier records a sale for them, or by pressing **Log visit** on the client's row.

### 1.1 What you get in the sidebar

A shop account shows these sections. Sections marked *optional* only appear when the matching switch is on in **Settings**.

- **Attendance** -- your employees' daily attendance
- **Staff** -- your employee roster
- **Clients** -- your customer list
- **Sales** -- record and review sales
- **Catalog** -- products and services you sell *(optional)*
- **Loyalty** -- reward rules and issuance history *(optional)*
- **Reports** -- takings, top clients, revenue by stylist, stock warnings
- **Closed Days** -- days the shop is shut, so staff are not marked absent
- **Devices**, **Enrollment**, **Accounts**, **Settings** -- setup and administration

Shops do not have **Promotion** or academic terms -- those are school-only.

## 2. Setting up, in the right order

Work through these once, in this order. Later steps depend on earlier ones.

1. **Settings** -- set your currency, timezone, and which modules you use (products, services, loyalty). Set your shop name and logo.
2. **Closed Days** -- add your weekly closing day and any known holidays.
3. **Catalog** -- add the services and products you sell, with prices.
4. **Staff** -- add your employees.
5. **Enrollment** -- enrol each employee's fingerprint at the device.
6. **Accounts** -- create logins for your manager and cashiers.
7. **Clients** -- add customers as they come in. There is no need to pre-load them.
8. **Loyalty** -- once you have a catalog, create your reward rules.

> [!TIP] Do steps 1--3 before you record a single sale. Prices and currency are captured onto each sale at the moment it is recorded, so getting them right first saves you correcting history later.

## 3. Settings that matter for a shop

Found under **Settings**. Only a super admin can change these.

| Setting | What it does |
| --- | --- |
| **Currency** | The denomination all money is shown in (GHS, NGN, USD, ...). Display only -- it does not convert existing figures, so choose it once at setup and leave it. |
| **Sell products** | Off hides the Products tab and product line items. Turn off if you are service-only. |
| **Sell services** | Off hides the Services tab and service line items. Turn off if you are a pure retail kiosk. |
| **Enable loyalty rewards** | Off hides the whole Loyalty section. Existing history is kept and resumes if you turn it back on. |
| **Timezone** | Decides when "today" starts and ends for visits, takings, and absence marking. |
| **Skip weekends** | Leave this **off** for most shops -- salons and shops usually trade on Saturdays. Use **Closed Days** instead. |
| **Track staff** | Must be on for employee attendance. |

> [!WARNING] Turning off **Sell products** or **Sell services** only hides them from new sales. It never rewrites past sales -- old records keep their item names and prices and still appear correctly in Reports.

## 4. Clients

**Clients** are your customers. They are a separate list from **Staff** -- a client is not an employee and has no fingerprint.

### 4.1 Adding a client

1. Go to **Clients** and press **Add client**.
2. Enter the name and phone number. Optionally add their area of residence.
3. Press **Save**.

**Phone number is required and must be unique.** It is the identity key that ties a customer to their visit history and loyalty progress. Two clients cannot share a number. Enter it in full including the country code -- the system stores it in a standard form for you.

### 4.2 Working with a client

Each row on the **Clients** page has these actions:

| Action | What it does |
| --- | --- |
| **Log visit** | Records that the client came in today, without recording a sale. |
| **Visit history** | Shows every day this client has been in. |
| **Loyalty progress** | Shows how close they are to each active reward. |
| **Edit** | Change name, phone, or area. |
| **Archive** | Hides them from the active list, keeping all their history. |

### 4.3 Archiving, not deleting

Archive a client who has stopped coming. Their sales and visits stay intact and continue to count in Reports. Use the status filter on the Clients page to see archived entries again.

> [!TIP] A client only ever counts **one visit per day**, no matter how many sales they make that day. That keeps visit-based loyalty rules honest.

## 5. Catalog -- products and services

**Catalog** holds everything you can put on a sale. It has two tabs.

| | **Products** | **Services** |
| --- | --- | --- |
| Examples | Hair food, clippers, shampoo | Retwist, wash, haircut |
| Has a price | Yes | Yes |
| Has stock | Yes -- counts down on each sale | No |

### 5.1 Adding an item

1. Go to **Catalog** and pick the **Products** or **Services** tab.
2. Press **Add product** or **Add service**.
3. Enter the name and price. For a product, enter the stock you currently hold.
4. Press **Save**.

Two active items cannot share the same name within a tab. If you archive an item, its name becomes free to use again.

### 5.2 Changing a price

Edit the item and save. **The new price applies only to future sales.** Every past sale keeps the price it was recorded at, so your historical takings never shift under you.

### 5.3 Archiving an item

Press **Archive** on the row. The item disappears from new sales but stays attached to every past sale that used it, so old receipts and reports stay complete. Items are never permanently deleted.

### 5.4 Stock

Product stock counts down automatically each time the product is sold. Stock is allowed to go negative -- the system will not block a sale because the count says zero, since the count may simply be out of date. Correct it by editing the product and typing the true figure.

**Reports -> Low stock** lists every active product at 5 units or fewer.

## 6. Recording a sale

This is the main daily task. Go to **Sales** and press the button to record a new sale.

1. **Client** -- required. Start typing to find them, or add the client first if they are new.
2. **Stylist / staff** -- optional. Set this if you want **Reports -> By stylist** to attribute the work.
3. **Items** -- add a line for each product or service. Set the quantity.
4. **Discount** -- to discount a line, edit its price directly on that line.
5. **Note** -- optional, e.g. *"Client paid in cash"*.
6. Press save.

Recording a sale does three things at once: it stores the sale, it counts today as a visit for that client, and it reduces stock for any products sold.

> [!NOTE] Each line stores the item's name and price **as they were at that moment**. Renaming or repricing a catalog item later never changes a sale that is already recorded.

## 7. Loyalty rewards

**Loyalty** lets you define reward rules and see who has earned what. It is a punch-card system: you set a target, the system counts towards it from real sales and visits, and tells you when a client qualifies.

### 7.1 Building a rule

Press to add a rule and fill in the three parts.

**Give the rule a name** -- write it the way you would say it aloud, e.g. *"Free wash every 10 retwists"*.

**Condition -- what are you counting?**

| Count | Meaning |
| --- | --- |
| **Number of services** | Service lines sold. Optionally narrowed to one specific service. |
| **Number of products** | Product lines sold. Optionally narrowed to one specific product. |
| **Number of visits** | Days the client came in. |
| **Total amount spent** | Money spent, in your currency. |

Then set the target number, and the **counting window**:

- **Since last reward issued (punch-card)** -- the usual choice. The count resets each time they earn the reward.
- **All time** -- counts their entire history.
- **Rolling window (days)** -- counts only the last N days.

**Repeatable** -- leave ticked so the reward can be earned again and again.

**Reward -- what do they get?** Choose a free service, a free product, a discount amount, or *Custom* with a free-text description.

### 7.2 Issuing a reward

Rules do not apply themselves to a sale. When a client qualifies you issue the reward, and it is logged against them under the **History** tab.

Every reward is issued by hand. Nothing is issued automatically, and nothing is ever applied to a sale for you -- somebody still gives the customer the free wash and records it here.

> [!TIP] Check **Loyalty progress** on the client's row while they are still in the shop. That is the moment to tell them they are two visits from a free treatment.

## 8. Reports

**Reports** is available to admins and super admins. Each tab answers one question.

| Tab | Answers |
| --- | --- |
| **Takings** | What did we make, by day and by week? |
| **By client** | Who spends the most with us? |
| **By stylist** | How much revenue did each staff member bring in? |
| **Items** | What sells most? |
| **Visits** | How often do clients come back? |
| **Low stock** | What do I need to reorder? (5 units or fewer) |
| **Rewards** | Which rewards have been issued, and when? |

Stylist figures only count sales where somebody filled in the stylist field, so make that a habit at the till if you want that tab to be meaningful.

## 9. Employee attendance

Your employees are on the **Staff** page and scan the fingerprint device exactly as in any other institution.

1. Add the employee under **Staff**.
2. Go to **Enrollment**, create a job for that person, pick the device, and queue it.
3. The employee places their finger twice at the device when prompted.
4. From then on they scan at the start of each day (or in and out, depending on your scan mode).

**Closed Days** is where you record the days the shop is shut. Staff are not marked absent on those days. Add your weekly closing day and public holidays here; tick *Recurring* for holidays that fall on the same date every year.

### 9.1 Staff who are also cashiers

If somebody both clocks in with a fingerprint *and* logs in to record sales, you can link their login to their staff record when creating the account. This keeps one person from appearing as two unrelated entries.

## 10. Who can do what

| | Super admin | Admin | Cashier |
| --- | --- | --- | --- |
| Record a sale | Yes | Yes | Yes |
| Add and edit clients | Yes | Yes | Yes |
| View and edit catalog | Yes | Yes | Yes |
| Loyalty rules and issuing | Yes | Yes | No |
| Reports | Yes | Yes | No |
| Staff roster and attendance | Yes | Yes | No |
| Devices and enrollment | Yes | No | No |
| Accounts | Yes | View only | No |
| Settings | Yes | No | No |

**Cashier** is the till role: clients, sales, and catalog, and nothing else. Give your counter staff this role. It keeps takings reports, staff attendance, and settings out of reach without getting in the way of serving customers.

## 11. Device quick reference

The screen on the device tells you what it is doing. This is the fastest way to check without opening the dashboard.

| Screen shows | Meaning |
| --- | --- |
| Clock and device name | Normal, waiting for a scan |
| A name, then Present / Time In / Time Out | Scan recognised and recorded |
| A name and "Offline" | Recognised, but no internet -- it is saved and will upload itself |
| "COOLDOWN" and a name | Same person scanned again within a minute. Normal. |
| "NO MATCH" | Finger not recognised. Try again. |
| A "queued" count under the clock | That many scans are waiting for the internet to return |
| "PENDING" and a MAC address | Device not yet assigned -- see the Super Administrator Manual |
| "OTA UPDATE" / "Do not unplug" | Installing an update. Leave it powered on. |

| Light | Meaning |
| --- | --- |
| Solid blue | Ready, online |
| Solid purple | Ready, but no WiFi |
| Green flash | Scan accepted |
| Red flash | Not recognised |
| Breathing yellow | Waiting to be assigned |
| Breathing red | Installing an update -- do not unplug |

## 12. Everyday problems

| Problem | What to do |
| --- | --- |
| Can't add a client -- phone rejected | That number already belongs to another client, including an archived one. Search for it. |
| Can't add a product -- name rejected | An active item already uses that name. Rename, or find and reuse the existing one. |
| A sale went in wrong | Record the correction and note it. Ask your super admin if a record needs removing. |
| Stock count is wrong | Edit the product and type the true figure. |
| Staff member marked absent on a closed day | Add that date under **Closed Days**. |
| "By stylist" report looks empty | The stylist field was left blank on those sales. |
| Device screen shows a queue count | It has lost WiFi. Scans are safe and upload automatically. Check the router. |
