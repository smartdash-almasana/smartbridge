from fastapi import Request
from fastapi.responses import HTMLResponse
from fastapi.routing import APIRouter
from fastapi.templating import Jinja2Templates

router = APIRouter(tags=["landing"])

_templates = Jinja2Templates(directory="app/api/templates")


@router.get("/", response_class=HTMLResponse)
def landing(request: Request) -> HTMLResponse:
    return _templates.TemplateResponse(request=request, name="landing.html")
