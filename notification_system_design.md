# Stage 1

## Notification System Design

This document outlines the REST API design, contract, and structure for a campus notification platform where students receive real-time updates regarding Placements, Events, and Results.

### 1. Core Actions
The notification platform supports the following core actions:
*   **Send Notification:** Triggered by authorized staff (e.g., HR for Placements, Faculty for Results).
*   **Fetch Notifications:** Retrieved by students to view their inbox.
*   **Mark as Read:** Allows students to manage their notification state.
*   **Real-time Delivery:** Immediate push to active users.

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

*   **Logic:** When a student logs into the frontend, a persistent WebSocket connection is established between the client and the Notification Microservice.
*   **Process:** 
    1.  The `POST /notifications` endpoint receives a new message and saves it to the database.
    2.  The service identifies if the target `studentId` is currently online.
    3.  If online, the message is pushed directly over the active WebSocket channel.
    4.  If offline, the notification remains in the "Unread" state until the student next fetches their notifications.
*   **Fallback:** For mission-critical alerts (like high-priority Placements), the system will trigger a fallback to **Server-Sent Events (SSE)** or **Push Notifications** (via Firebase/APNs) for mobile devices.

---

# Stage 2

## Database Design

### 1. Choice of Persistent Storage: PostgreSQL (Relational DB)
I suggest using a Relational Database like **PostgreSQL** for this system.

**Reasoning:**
*   **Structured Data:** Notifications have a very consistent structure (Type, Message, StudentID) which fits perfectly into tables.
*   **ACID Compliance:** Ensuring a notification is "Marked as Read" reliably requires transaction integrity.
*   **Relational Integrity:** We can enforce Foreign Key constraints between Students and Notifications to prevent orphaned data.
*   **Indexing:** PostgreSQL provides robust indexing (B-Tree, GIN) which is critical for fetching notifications by `student_id` or `type` quickly.
*   **Future Proofing:** If we later need to join with other campus data (like Course or Department), SQL makes this trivial.

### 2. Database Schema
We will use two primary tables:

#### **Students Table**
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | UUID | Primary Key |
| `roll_no` | VARCHAR(20) | Unique, Indexed |
| `email` | VARCHAR(255) | Unique |
| `name` | VARCHAR(100) | |

#### **Notifications Table**
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | UUID | Primary Key |
| `student_id` | UUID | Foreign Key (Students.id), Indexed |
| `type` | ENUM | ('PLACEMENT', 'EVENT', 'RESULT'), Indexed |
| `title` | VARCHAR(100) | |
| `message` | TEXT | |
| `is_read` | BOOLEAN | Default: FALSE, Indexed |
| `created_at` | TIMESTAMP | Default: NOW(), Indexed |

### 3. Potential Scalability Problems
As the volume increases (e.g., millions of notifications), several issues may arise:
*   **Read Latency:** Fetching notifications for a single student out of millions can become slow if indexes don't fit in memory (RAM).
*   **Write Throughput:** High-frequency "Notify All" events (sending to 50,000 students at once) can lock the table or cause I/O bottlenecks.
*   **Index Bloat:** As notifications grow, indexes become large and slow down both reads and writes.
*   **Storage Costs:** Storing years of notifications for every student can consume massive disk space.

**Proposed Solutions:**
*   **Partitioning:** Split the `notifications` table by `created_at` (e.g., monthly partitions).
*   **Archiving:** Move notifications older than 6 months to a secondary "Archive" table or cold storage.
*   **Caching:** Use Redis to store the "Unread Count" or the latest 10 notifications for each student.

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

*   **Is it accurate?** No, it is partially inaccurate. Using `SELECT *` is inefficient as it fetches all columns, including potentially large `message` blobs, which increases I/O and memory usage. Additionally, unless `studentID` and `isRead` are indexed together, the database has to perform a scan.
*   **Why is it slow?** 
    1.  **Sequential Scan:** With 5,000,000 notifications, the DB likely has to scan a significant portion of the table (O(N) complexity) to find matching rows.
    2.  **Sorting Cost:** The `ORDER BY createdAt DESC` requires the DB to sort the filtered results in memory or on disk (O(N log N)), which is extremely expensive for large datasets.
    3.  **High I/O:** `SELECT *` fetches unnecessary data, slowing down the transfer from disk to memory.

### 2. Proposed Changes
*   **Composite Index:** Create a composite index on `(student_id, is_read, created_at DESC)`. This allows the DB to jump directly to the student's unread notifications and read them in the correct order without a separate sorting step.
*   **Column Selection:** Only fetch the specific columns needed by the UI (e.g., `id`, `type`, `title`, `created_at`).

### 3. Computation Cost of Indexing
Adding indexes on every column (as suggested by the other developer) is **not effective** and can be harmful:
*   **Write Penalty:** Every `INSERT`, `UPDATE`, or `DELETE` becomes slower because the DB must update all affected indexes.
*   **Storage Overhead:** Indexes consume disk space. In a table with 5M rows, redundant indexes could double or triple the storage requirement.
*   **Optimizer Confusion:** Too many indexes can sometimes confuse the query planner, leading it to choose a less efficient path.

**The "Safe" Advice:** Only index columns used in `WHERE`, `JOIN`, or `ORDER BY` clauses.

### 4. Students with "Placement" Notifications (Last 7 Days)
```sql
SELECT DISTINCT student_id
FROM notifications
WHERE notification_type = 'Placement'
  AND created_at >= NOW() - INTERVAL '7 days';
```
*(Assumes `notification_type` is an enum and `created_at` is indexed).*
