-- MVP-BETA-004 (#41): account deletion and the corrected Gmail-disconnect
-- purge both need to DELETE a subscription row directly (not just cascade it
-- transitively from users), and subscription_candidates.resolved_subscription_id
-- had no ON DELETE behavior (default NO ACTION) - reproduced against a real
-- database, deleting a subscription that a confirmed candidate resolved to
-- throws "violates foreign key constraint
-- subscription_candidates_resolved_subscription_id_fkey" and rolls back the
-- whole disconnect. SET NULL (not CASCADE) because a confirmed/rejected
-- candidate is itself part of what gets explicitly purged by both operations
-- going forward, not data that should silently vanish as a side effect of
-- deleting the subscription it resolved to from some other, future code path.
ALTER TABLE subscription_candidates
  DROP CONSTRAINT subscription_candidates_resolved_subscription_id_fkey;
ALTER TABLE subscription_candidates
  ADD CONSTRAINT subscription_candidates_resolved_subscription_id_fkey
  FOREIGN KEY (resolved_subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;
