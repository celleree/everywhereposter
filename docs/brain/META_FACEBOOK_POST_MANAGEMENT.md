# Facebook text/feed management

Implementation contract for Meta App Review. Provider behavior still needs separately authorized live verification; deterministic tests are not Meta permission approval.

## Supported path

An administrator can open a published Facebook Page copy from its Calendar entry or from **Published** in the scheduled-posts list. Select the Page's entry and choose **Manage Facebook post**. On mobile, **Delete on platform** also opens the same panel. It shows the Page name, published message, and a link to the post on Facebook.

**Delete from Facebook** opens a confirmation naming the Page and quoting the published message. **Confirm Facebook deletion** deletes that remote post. **Cancel** or Escape dismisses the confirmation. Each sibling destination keeps its own publication and status.

Deletion requires a trusted receipt for a message-only Page feed post. A URL in the message qualifies, including in a multi-destination **Post now** submission. Explicit link attachments, media and child posts are ineligible. Imported posts are read-only. For an earlier Calendar copy without a receipt, open the exact post on its Facebook Page, verify the Page and message, and delete it through the post menu.

**Save Facebook message** is available for a plain-text post with the original single-destination durable receipt. It changes only the message under the same remote ID.

## Server guarantees

- Authentication middleware supplies organization membership. New management routes explicitly require an enabled ADMIN/SUPERADMIN independently of billing policy configuration.
- Guided publishing records the provider result on each `PublishingSubmissionDestination`. Calendar reserves a private `FacebookPublicationReceipt` row for each eligible new immediate Facebook root outside that ledger. The worker binds the successful provider result to the organization, integration, Page and persisted post. A message with a body URL earns a delete-only `facebookFeed` receipt. Existing receipts and older posts are left in place.
- All new Graph calls use supported v25.0. Update uses `POST /PAGE_POST_ID` with `message`, then `GET` of the same ID to confirm its message. Delete requires an explicit `{success:true}` from `DELETE /PAGE_POST_ID`. No delete-and-republish, automatic mutation retry, or interpretation of Graph 100/404 as deletion occurs.
- Mutations validate organization, integration state, Page, receipt/app/remote identity, PUBLISHED state and content type. Payloads accept only action, revision and the edit message. Legacy update/delete entry points remain blocked for Facebook. The provider-function dispatcher has an explicit list of existing read helpers; newly added methods are not automatically exposed.
- PostgreSQL compare-and-set on the selected destination’s receipt reserves each mutation. A stale editor or another worker cannot overwrite the claim. `providerState` retains its original publishing meaning.
- Last confirmed content/state remains authoritative until Meta confirms success. Success is recorded before a transaction finalizes local content or the remote-deleted tombstone. An interrupted finalization can replay from its success receipt without a new Graph mutation.
- **Check result** uses read-only reconciliation for an uncertain edit. An in-flight/crashed worker stays locked. An ambiguous delete stays locked for operator investigation; inaccessible content is not proof of deletion. There is deliberately no automatic force-unlock or destructive retry endpoint.
- Historical import and deletion serialize on the authoritative Post row. Confirmed deletion survives historical re-import and late publishing-workflow state updates. Platform media results exclude known remote-deleted records, including locally hidden tombstones.

## Official contract evidence

Meta's [Page posts guide](https://developers.facebook.com/documentation/pages-api/posts) documents feed creation, updating only app-created Page posts through `POST /PAGE_POST_ID`, and deletion through `DELETE /PAGE_POST_ID`. [Permission reference](https://developers.facebook.com/docs/permissions) describes `pages_manage_posts` and its Page-read/list dependencies. [Version support](https://developers.facebook.com/docs/graph-api/changelog/versions/) lists v20 retirement on September 24, 2026 and v25 support through July 29, 2028. The implementation upgrades the feed call and new management calls; it does not globally rewrite unrelated Meta endpoints.

| Permission | Demonstration | Implemented surface | Remaining evidence |
| --- | --- | --- | --- |
| pages_manage_posts | Login/Page selection, create, same-ID edit, delete, updated result | Create and published text/feed panel | Authorized real Page/token and disposable-content scope; live recording |
| pages_read_user_content | Retrieve actual outside-person comment | Existing published comments panel; mapping regression | Actual outside-person comment, live retrieval and recording |

## Verification and review order

Review the receipt/provider contract, service eligibility and durable CAS, controller/dispatcher boundaries, tombstone/replay protection, then UI/creation opt-in and tests. This coherent security/state change exceeds the usual small-PR target because enabling only the provider, UI or ledger boundary would leave an incomplete mutation path. Review the additive private receipt table with the publishing changes. The existing administrator roles and Graph permissions apply.

`pnpm exec jest -c jest.published-posts.config.cjs --runInBand` runs the unit/provider/controller regressions. Set `EP_SUBMISSION_TEST_DATABASE_URL=postgresql://isolated:isolated@127.0.0.1:55462/isolated` only for the explicitly provisioned disposable PostgreSQL fixture. CI creates that fixture and applies the existing committed migrations, including SQL CHECK constraints not represented by `prisma db push`. PostgreSQL tests exercise actual cross-worker CAS, local failure recovery, ordinary-upsert rejection, workflow replay and historical tombstones with only Graph mocked.

The browser fixture adapter and Playwright cases report their actual boundary separately. Neither fixture data nor an emulator establishes live Meta acceptance or physical iPhone behavior. No live mutation, merge or deployment is authorized by this document.
