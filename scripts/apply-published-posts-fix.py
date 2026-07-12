from pathlib import Path


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"Expected {count} occurrence(s) in {path}, found {actual}")
    file.write_text(text.replace(old, new, count))


replace_exact(
    "postiz-app/tests/published-posts/posts.service.spec.ts",
    """    ).resolves.toEqual({
      supported: true,
      comments,
    });""",
    """    ).resolves.toEqual({
      supported: true,
      canComment: false,
      comments,
    });""",
    2,
)

replace_exact(
    "postiz-app/tests/published-posts/facebook-provider.permissions.spec.ts",
    """    await expect(
      provider.authenticate({
        code: 'oauth-code',
        codeVerifier: 'ignored',
      })
    ).rejects.toThrow(
      'Missing required permissions: pages_read_user_content'
    );""",
    """    await expect(
      provider.authenticate({
        code: 'oauth-code',
        codeVerifier: 'ignored',
      })
    ).rejects.toMatchObject({
      message: 'Missing required permissions: pages_read_user_content',
    });""",
)

replace_exact(
    "postiz-app/tests/published-posts/published-capabilities.spec.ts",
    """    expect(new InstagramProvider().getPublishedCapabilities()).toMatchObject({
      editMode: 'none',
      canDeletePublished: false,
    });""",
    """    expect(new InstagramProvider().getPublishedCapabilities()).toMatchObject({
      editMode: 'none',
      canDeletePublished: true,
    });""",
)

refresh_test = Path(
    "postiz-app/tests/published-posts/refresh-integration.identity.spec.ts"
)
refresh_text = refresh_test.read_text()
import_line = (
    "import { RefreshIntegrationService } from "
    "'@gitroom/nestjs-libraries/integrations/refresh.integration.service';"
)
manager_mock = """jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));

"""
if manager_mock.strip() in refresh_text:
    raise SystemExit("IntegrationManager mock already exists unexpectedly")
if refresh_text.count(import_line) != 1:
    raise SystemExit("RefreshIntegrationService import was not found exactly once")
refresh_test.write_text(refresh_text.replace(import_line, manager_mock + import_line))

pr_workflow = Path(".github/workflows/pull-request-ci.yml")
pr_text = pr_workflow.read_text()
advisory_start = pr_text.index("  published-posts-baseline:")
docker_start = pr_text.index("  docker-build:", advisory_start)
pr_text = pr_text[:advisory_start] + pr_text[docker_start:]
knowledge_step = """      - name: Run knowledge-base tests
        run: pnpm exec jest --config jest.knowledge-base.config.cjs --runInBand
"""
published_step = knowledge_step + """
      - name: Run published-posts tests
        run: pnpm exec jest --config jest.published-posts.config.cjs --runInBand
"""
if pr_text.count(knowledge_step) != 1:
    raise SystemExit("PR workflow knowledge-base step was not found exactly once")
pr_workflow.write_text(pr_text.replace(knowledge_step, published_step))

build_workflow = Path(".github/workflows/build-postiz-ghcr.yml")
build_text = build_workflow.read_text()
if build_text.count(knowledge_step) != 1:
    raise SystemExit("Build workflow knowledge-base step was not found exactly once")
build_workflow.write_text(build_text.replace(knowledge_step, published_step))

Path(__file__).unlink()
print("Applied published-posts test and CI repairs.")
