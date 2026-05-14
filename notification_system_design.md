# Stage 1

## Notification System Design

This document outlines the REST API design, contract, and structure for a campus notification platform where students receive real-time updates regarding Placements, Events, and Results.

### 1. Core Actions

The notification platform supports the following core actions:

- **Send Notification:** Triggered by authorized staff (e.g., HR for Placements, Faculty for Results).
- **Fetch Notifications:** Retrieved by students to view their inbox.
- **Mark as Read:** Allows students to manage their notification state.
- **Real-time Delivery:** Immediate push to active users.

### 2. REST API Endpoints

#### A. Send Notification

**Endpoint:** `POST /api/v1/notifications`  
**Description:** Sends a notification to a specific student or a group.  
**Headers:**

```http
Content-Type: application/json
Authorization: Bearer <token>
```

**Request Body:**

```json
{
  "studentId": "STU12345",
  "type": "PLACEMENT",
  "title": "New Job Posting",
  "message": "CSX Corporation is hiring for Software Engineers. Apply by tomorrow.",
  "priority": "HIGH"
}
```

**Response (201 Created):**

```json
{
  "notificationId": "notif-98765",
  "status": "queued",
  "timestamp": "2026-05-14T18:30:00Z"
}
```

#### B. Fetch Student Notifications

**Endpoint:** `GET /api/v1/students/{studentId}/notifications`  
**Description:** Retrieves all notifications for a specific student.  
**Headers:**

```http
Authorization: Bearer <token>
```

**Response (200 OK):**

```json
{
  "studentId": "STU12345",
  "notifications": [
    {
      "id": "notif-98765",
      "type": "PLACEMENT",
      "title": "New Job Posting",
      "message": "CSX Corporation is hiring...",
      "isRead": false,
      "createdAt": "2026-05-14T18:30:00Z"
    }
  ]
}
```

#### C. Mark Notification as Read

**Endpoint:** `PATCH /api/v1/notifications/{id}/read`  
**Description:** Updates the status of a specific notification to 'read'.  
**Response (204 No Content):** (Success)

### 3. JSON Schemas

#### Notification Object Schema

```json
{
  "type": "object",
  "required": ["studentId", "type", "title", "message"],
  "properties": {
    "studentId": { "type": "string" },
    "type": { "enum": ["PLACEMENT", "EVENT", "RESULT"] },
    "title": { "type": "string", "maxLength": 100 },
    "message": { "type": "string", "maxLength": 1000 },
    "isRead": { "type": "boolean", "default": false },
    "createdAt": { "type": "string", "format": "date-time" }
  }
}
```

### 4. Real-time Notification Mechanism

To ensure students receive updates instantly, the system will use **WebSockets**.

- **Logic:** When a student logs into the frontend, a persistent WebSocket connection is established between the client and the Notification Microservice.
- **Process:**
  1.  The `POST /notifications` endpoint receives a new message and saves it to the database.
  2.  The service identifies if the target `studentId` is currently online.
  3.  If online, the message is pushed directly over the active WebSocket channel.
  4.  If offline, the notification remains in the "Unread" state until the student next fetches their notifications.
- **Fallback:** For mission-critical alerts (like high-priority Placements), the system will trigger a fallback to **Server-Sent Events (SSE)** or **Push Notifications** (via Firebase/APNs) for mobile devices.

---

# Stage 2

## Database Design

### 1. Choice of Persistent Storage: PostgreSQL (Relational DB)

I suggest using a Relational Database like **PostgreSQL** for this system.

**Reasoning:**

- **Structured Data:** Notifications have a very consistent structure (Type, Message, StudentID) which fits perfectly into tables.
- **ACID Compliance:** Ensuring a notification is "Marked as Read" reliably requires transaction integrity.
- **Relational Integrity:** We can enforce Foreign Key constraints between Students and Notifications to prevent orphaned data.
- **Indexing:** PostgreSQL provides robust indexing (B-Tree, GIN) which is critical for fetching notifications by `student_id` or `type` quickly.
- **Future Proofing:** If we later need to join with other campus data (like Course or Department), SQL makes this trivial.

### 2. Database Schema

We will use two primary tables:

#### **Students Table**

| Column    | Type         | Constraints     |
| :-------- | :----------- | :-------------- |
| `id`      | UUID         | Primary Key     |
| `roll_no` | VARCHAR(20)  | Unique, Indexed |
| `email`   | VARCHAR(255) | Unique          |
| `name`    | VARCHAR(100) |                 |

#### **Notifications Table**

| Column       | Type         | Constraints                               |
| :----------- | :----------- | :---------------------------------------- |
| `id`         | UUID         | Primary Key                               |
| `student_id` | UUID         | Foreign Key (Students.id), Indexed        |
| `type`       | ENUM         | ('PLACEMENT', 'EVENT', 'RESULT'), Indexed |
| `title`      | VARCHAR(100) |                                           |
| `message`    | TEXT         |                                           |
| `is_read`    | BOOLEAN      | Default: FALSE, Indexed                   |
| `created_at` | TIMESTAMP    | Default: NOW(), Indexed                   |

### 3. Potential Scalability Problems

As the volume increases (e.g., millions of notifications), several issues may arise:

- **Read Latency:** Fetching notifications for a single student out of millions can become slow if indexes don't fit in memory (RAM).
- **Write Throughput:** High-frequency "Notify All" events (sending to 50,000 students at once) can lock the table or cause I/O bottlenecks.
- **Index Bloat:** As notifications grow, indexes become large and slow down both reads and writes.
- **Storage Costs:** Storing years of notifications for every student can consume massive disk space.

**Proposed Solutions:**

- **Partitioning:** Split the `notifications` table by `created_at` (e.g., monthly partitions).
- **Archiving:** Move notifications older than 6 months to a secondary "Archive" table or cold storage.
- **Caching:** Use Redis to store the "Unread Count" or the latest 10 notifications for each student.

### 4. Implementation Queries

#### Fetch all unread notifications for a student

```sql
SELECT id, type, title, message, created_at
FROM notifications
WHERE student_id = 'STUDENT_UUID'
  AND is_read = FALSE
ORDER BY created_at DESC;
```

#### Mark a notification as read

```sql
UPDATE notifications
SET is_read = TRUE
WHERE id = 'NOTIFICATION_UUID';
```

#### Insert a new notification

```sql
INSERT INTO notifications (student_id, type, title, message)
VALUES ('STUDENT_UUID', 'PLACEMENT', 'Job Alert', 'New posting for SDE role...');
```

---

# Stage 3

## Query Optimization

### 1. Accuracy and Performance Analysis

**Original Query:**

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

- **Is it accurate?** No, it is partially inaccurate. Using `SELECT *` is inefficient as it fetches all columns, including potentially large `message` blobs, which increases I/O and memory usage. Additionally, unless `studentID` and `isRead` are indexed together, the database has to perform a scan.
- **Why is it slow?**
  1.  **Sequential Scan:** With 5,000,000 notifications, the DB likely has to scan a significant portion of the table (O(N) complexity) to find matching rows.
  2.  **Sorting Cost:** The `ORDER BY createdAt DESC` requires the DB to sort the filtered results in memory or on disk (O(N log N)), which is extremely expensive for large datasets.
  3.  **High I/O:** `SELECT *` fetches unnecessary data, slowing down the transfer from disk to memory.

### 2. Proposed Changes

- **Composite Index:** Create a composite index on `(student_id, is_read, created_at DESC)`. This allows the DB to jump directly to the student's unread notifications and read them in the correct order without a separate sorting step.
- **Column Selection:** Only fetch the specific columns needed by the UI (e.g., `id`, `type`, `title`, `created_at`).

### 3. Computation Cost of Indexing

Adding indexes on every column (as suggested by the other developer) is **not effective** and can be harmful:

- **Write Penalty:** Every `INSERT`, `UPDATE`, or `DELETE` becomes slower because the DB must update all affected indexes.
- **Storage Overhead:** Indexes consume disk space. In a table with 5M rows, redundant indexes could double or triple the storage requirement.
- **Optimizer Confusion:** Too many indexes can sometimes confuse the query planner, leading it to choose a less efficient path.

**The "Safe" Advice:** Only index columns used in `WHERE`, `JOIN`, or `ORDER BY` clauses.

### 4. Students with "Placement" Notifications (Last 7 Days)

```sql
SELECT DISTINCT student_id
FROM notifications
WHERE notification_type = 'Placement'
  AND created_at >= NOW() - INTERVAL '7 days';
```

_(Assumes `notification_type` is an enum and `created_at` is indexed)._

---

# Stage 4

## Load Handling & UX

### 1. Proposed Solutions to Improve Performance

To prevent the database from being overwhelmed when 50,000 students fetch notifications simultaneously, I suggest the following multi-layered approach:

#### **A. Redis Caching (Read-Aside Pattern)**

Instead of hitting the DB on every page load, store the latest 10-20 notifications and the "Unread Count" in a fast, in-memory Redis cache.

- **Workflow:** App checks Redis first. If the data is missing (Cache Miss), it fetches from the DB and populates the cache. When a new notification arrives, the cache is invalidated or updated.

#### **B. Cursor-based Pagination**

Never fetch "all" notifications. Use cursor-based pagination (e.g., `WHERE created_at < 'last_seen_timestamp' LIMIT 15`) to fetch notifications in small, manageable chunks.

#### **C. Debouncing & Pull-to-Refresh**

On the frontend, avoid automatic fetching on every single page navigation. Use a "Pull-to-Refresh" pattern or only fetch when the user explicitly clicks the "Notification Bell".

### 2. Tradeoffs Analysis

| Strategy              | Pros                                                                                                 | Cons                                                                                                                           |
| :-------------------- | :--------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| **Redis Caching**     | Extremely fast (sub-millisecond) reads; significantly reduces DB load.                               | Added infrastructure complexity; risk of "Stale Data" if cache invalidation logic fails.                                       |
| **Cursor Pagination** | Consistent performance regardless of deep scrolling; avoids the "Offset" performance penalty in SQL. | Slightly more complex frontend logic; doesn't support jumping to a specific page number.                                       |
| **WebSockets/SSE**    | Eliminates the need for "polling" (constant fetching); provides a superior real-time UX.             | High memory usage on the server (maintaining 50,000 open connections); requires a Load Balancer that supports sticky sessions. |

### 3. Recommendation

For a campus environment, I recommend **Redis Caching** combined with **Cursor-based Pagination**. This ensures that the initial page load is nearly instantaneous while keeping the database load predictable even during "Placement Season" peaks.

---

# Stage 5

## "Notify All" Logic Redesign

### 1. Shortcomings of Current Implementation

The current `notify_all` function using a simple `for` loop has critical flaws:

- **Synchronous Bottleneck:** It processes 50,000 students one by one. If each iteration takes 200ms (DB + Email API + App Push), the entire process would take **nearly 3 hours** to complete.
- **Blocking Operation:** The request will likely timeout, leaving the HR manager uncertain if the task finished.
- **Resource Exhaustion:** Making 50,000 sequential DB inserts and API calls in a single thread can exhaust memory and connection pools.
- **Lack of Atomicity:** There is no "all or nothing" logic.

### 2. Failure Analysis (200 Emails Fail Midway)

If the process fails for 200 students in the middle:

- **Data Inconsistency:** The students before the failure received the notification; those after did not.
- **No Retry Mechanism:** In a `for` loop, once an exception is thrown, the remaining 25,000+ students are skipped unless wrapped in complex try/catch blocks.
- **Duplicate Risk:** If the HR clicks "Notify All" again to fix the error, the first 25,000 students will receive a **duplicate** notification.

### 3. Proposed Redesign: Message Queues (Asynchronous Processing)

To make this reliable and fast, we must use a **Producer-Consumer** pattern with a Message Queue (e.g., Redis-based **BullMQ** or **RabbitMQ**).

**The Strategy:**

1.  **Producer:** The HR request only creates a "Bulk Job" in the DB and pushes 50,000 small "tasks" into a queue. This takes seconds.
2.  **Consumer (Workers):** Multiple background workers pull tasks from the queue and process them in **parallel**.
3.  **Idempotency:** Each task includes a unique ID to ensure students never get the same notification twice.
4.  **Automatic Retries:** If an email fails, the queue automatically retries it with "exponential backoff".

### 4. Revised JavaScript Implementation
Using `async/await` and a queue-based approach (e.g., BullMQ) to handle 50,000 students efficiently.

```javascript
/**
 * PRODUCER: Triggered by HR "Notify All" action.
 * Distributes tasks to a background queue to avoid blocking the main thread.
 */
async function notifyAll(studentIds, message) {
    const batchId = await db.saveBatchRecord(message);
    
    // Instead of a for-loop that waits for each email, 
    // we bulk-add to a queue. This takes milliseconds.
    const jobs = studentIds.map(id => ({
        name: 'send_notification',
        data: { studentId: id, message, batchId },
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
    }));

    await notificationQueue.addBulk(jobs);
    
    return { status: "Processing", batchId };
}

/**
 * CONSUMER: Independent worker process.
 * Handles the actual delivery and persistence logic.
 */
worker.on('completed', async (job) => {
    const { studentId, message } = job.data;
    
    try {
        // Use Promise.all to perform local operations concurrently
        await Promise.all([
            saveToDb(studentId, message),
            pushToApp(studentId, message)
        ]);
        
        // Third-party API call (potential failure point)
        await sendEmail(studentId, message);
        
    } catch (error) {
        // Log error using mandatory middleware
        await Log('backend', 'error', 'service', `Notify Fail for ${studentId}: ${error.message}`);
        throw error; // Let the queue handle the retry
    }
});
```

---

# Stage 6

## Priority Inbox Efficiency

To maintain the **Top 10** notifications efficiently as new notifications arrive, I suggest the following strategy:

### 1. Data Structure: Min-Heap (Priority Queue)
Instead of re-sorting the entire dataset (which is O(N log N)) every time a new notification arrives, we can use a **Min-Heap** of size 10.
*   **Logic:** The heap will always store the 10 most "important" notifications. The "least important" of these top 10 is at the root.
*   **Efficiency:** When a new notification arrives, we compare it to the root of the heap. If it's more important, we replace the root and "re-heapify". This operation is **O(log 10)**, which is essentially constant time.

### 2. Backend Strategy: Redis Sorted Sets (ZSET)
In a real production environment, we can use **Redis Sorted Sets**:
*   **Score Calculation:** Assign a score to each notification based on its weight and timestamp:
    `Score = (Weight * 10^12) + Timestamp`
*   **Maintenance:** Use `ZADD` to add new notifications and `ZREMRANGEBYRANK` to keep only the top 10. This ensures the "Top 10" is always pre-calculated and can be fetched in **O(1)** time.
