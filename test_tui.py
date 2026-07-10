import pytest

from movesense.tui.app import MoveSenseApp


@pytest.mark.asyncio
async def test_menu_screen_shows_title_and_options():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        body = str(app.screen.query_one("#menu-body").render())
        assert "MoveSense Chess" in body
        assert "対戦モード" in body
        assert "詰めチェス" in body


@pytest.mark.asyncio
async def test_q_quits_the_app():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        await pilot.press("q")
        await pilot.pause()
        assert app.is_running is False
