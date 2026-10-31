"""Entry point: `uvicorn hq.main:app` (or `python -m hq.main`)."""
from .api import create_app

app = create_app()

if __name__ == "__main__":
    import os
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HQ_HOST", "127.0.0.1"), port=int(os.environ.get("HQ_PORT", "8000")))
