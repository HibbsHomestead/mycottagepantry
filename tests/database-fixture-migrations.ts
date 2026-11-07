import { readdir } from 'node:fs/promises'

export const enrollmentRecoveryMigration =
  '20261114010000_continue_admin_enrollment_recovery'
export const legacyEnrollmentRecoveryMigration =
  '20261113010000_recover_admin_enrollment'

export async function fixtureMigrationNames(root: URL) {
  // The dedicated recovery suite runs the full fresh migration chain as well as
  // explicit expired-account/refusal fixtures. Other suites control their own
  // account state, so they load the schema without this incident-specific action.
  return (await readdir(root))
    .sort()
    .filter(
      (name) =>
        name !== enrollmentRecoveryMigration &&
        name !== legacyEnrollmentRecoveryMigration,
    )
}
