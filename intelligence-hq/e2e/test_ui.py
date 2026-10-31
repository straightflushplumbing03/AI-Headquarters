"""Browser end-to-end test against a running server. The UI must show exactly what the backend stores.

Run:  HQ_E2E_URL=http://localhost:8000 HQ_E2E_TOKEN=<owner token> python -m pytest e2e -q
Start the server with HQ_SIMULATED_LATENCY_S=2 so agents stay busy long enough to observe.
"""
import os
import time

import httpx
import pytest

URL = os.environ.get("HQ_E2E_URL")
TOKEN = os.environ.get("HQ_E2E_TOKEN", "")
SHOTS = os.environ.get("HQ_E2E_SHOTS", "")
pytestmark = pytest.mark.skipif(not URL, reason="set HQ_E2E_URL to a running HQ server")


@pytest.fixture(scope="module")
def page():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        p = b.new_page(viewport={"width": 1440, "height": 900})
        errors: list[str] = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(URL)
        p.wait_for_selector("canvas", timeout=30000)
        p.wait_for_timeout(2500)
        p.errors = errors
        yield p
        b.close()


def api(path, method="GET", **kw):
    h = {"Authorization": f"Bearer {TOKEN}"}
    return httpx.request(method, URL + path, headers=h, timeout=20, **kw).json()


def shot(p, name):
    if SHOTS:
        p.screenshot(path=os.path.join(SHOTS, f"{name}.png"))


def stat(p, label):
    return int(p.locator(".stat", has_text=label).locator(".stat-n").inner_text().split("/")[0])


def test_dashboard_matches_backend(page):
    page.wait_for_timeout(3000)  # let the first frames render before the screenshot
    d = api("/api/dashboard")
    assert stat(page, "tasks done") == d["tasks_completed"]
    assert stat(page, "agents online") == d["agents_online"]
    assert stat(page, "need your approval") == d["pending_approvals"]
    assert page.locator(".roster li").count() == d["agents_total"]
    shot(page, "01-exterior")


def test_owner_runs_objective_and_office_shows_real_work(page):
    page.click("text=Owner sign-in")
    page.fill('input[aria-label="Owner token"]', TOKEN)
    page.click('button[type=submit]:has-text("Sign in")')
    page.wait_for_selector("text=Sign out")
    page.get_by_role("tab", name="Objectives").click()
    page.fill("#obj-title", "Win more water heater repair calls in Laguna Hills")
    page.click("text=Start objective")
    seen_working = False
    deadline = time.time() + 40
    while time.time() < deadline and not seen_working:
        agents = {a["id"]: a["status"] for a in api("/api/agents")}
        busy = [k for k, v in agents.items() if v in ("working", "researching", "reviewing")]
        if busy:
            page.wait_for_timeout(600)
            ui = page.locator(".roster li", has_text=api(f"/api/agents/{busy[0]}")["name"]).inner_text()
            backend_now = api(f"/api/agents/{busy[0]}")["status"]
            if backend_now != "idle":
                assert backend_now.capitalize() in ui
                seen_working = True
                page.click('button:has-text("Operations room")')
                page.wait_for_timeout(1500)
                shot(page, "02-working")
        time.sleep(0.4)
    assert seen_working, "never observed an agent working"


def test_loop_reaches_owner_and_approval_works_from_ui(page):
    deadline = time.time() + 120
    while time.time() < deadline:
        objs = api("/api/objectives")
        if objs and objs[0]["status"] == "awaiting_owner":
            break
        time.sleep(1)
    assert objs[0]["status"] == "awaiting_owner"
    assert len(api("/api/messages")) > 0
    page.get_by_role("tab", name="Messages").click()
    page.wait_for_timeout(800)
    assert page.locator(".messages li").count() > 0
    shot(page, "03-messages")
    page.get_by_role("tab", name="Approvals").click()
    page.wait_for_selector(".approvals li")
    shot(page, "04-approvals")
    page.locator(".approvals li").first.locator("button:has-text('Approve')").click()
    page.wait_for_timeout(1500)
    assert api("/api/objectives")[0]["status"] == "completed"


def test_agent_desk_shows_history_and_task_detail(page):
    page.locator(".roster button", has_text="Nova").click()
    page.wait_for_selector(".agent-head h2:has-text('Nova')")
    page.wait_for_timeout(2500)
    n = len(api("/api/agents/seo/tasks"))
    assert page.locator(".tasks .task").count() == n
    if n:
        page.locator(".tasks .task button").first.click()
        page.wait_for_selector(".detail h3")
        assert page.locator(".timeline li").count() >= 2
        shot(page, "05-task-detail")
        page.click(".detail button:has-text('Close')")
    shot(page, "06-agent-desk")


def test_emergency_stop_from_ui_is_enforced_by_backend(page):
    page.click(".topbar button.danger:has-text('Emergency stop')")
    page.wait_for_timeout(1200)
    assert api("/api/settings")["emergency_stop"] is True
    assert page.locator(".estop-flag").is_visible()
    shot(page, "07-emergency-stop")
    page.get_by_role("tab", name="Controls").click()
    page.click("button:has-text('Clear emergency stop')")
    page.wait_for_timeout(1000)
    assert api("/api/settings")["emergency_stop"] is False
    shot(page, "08-controls")


def test_no_javascript_errors(page):
    assert page.errors == []
