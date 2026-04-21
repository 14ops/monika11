# Task Management Security Specification (Directives)

## Data Invariants
1. A Task must belong to the authenticated user (`userId` matches `request.auth.uid`).
2. Priority and Status must be from the allowed set.
3. Users can only read/write their own tasks.
4. `userId` and `createdAt` are immutable after creation.
5. All IDs must be valid alphanumeric strings.

## The "Dirty Dozen" Payloads (Denial Expected)
1. **Identity Spoofing**: `create` task with `userId` of another user.
2. **State Shortcutting**: `update` task to skip status (though simplified here, we check for invalid keys).
3. **Ghost Fields**: `create` task with secret `isAdmin: true` field.
4. **ID Poisoning**: `get` task with a 1MB junk ID string.
5. **Unauthorized Read**: `list` tasks where `userId != auth.uid`.
6. **Cross-User Injection**: `update` another user's task.
7. **Type Mismatch**: `priority` set as an integer.
8. **Size Violation**: `title` exceeding 256 chars.
9. **Timestamp Spoofing**: `createdAt` set to a future date by client.
10. **Immortal Check Bypass**: Change `createdAt` on `update`.
11. **Null ID**: ID string empty.
12. **Insecure List**: Query all tasks without a filter.

## Test Runner (firestore.rules.test.ts)
(To be implemented in test environment)
