# Tekstservice: pdftotext (poppler-utils), OCR (ocrmypdf + tesseract, dansk og engelsk) og søgeordsforslag bag en
# lille FastAPI-tjeneste. Ingen sprogmodel, ingen eksterne tjenester.
FROM python:3.12-slim-bookworm

# tesseract-ocr-osd bruges til at rette sider, der ligger på siden (--rotate-pages); ghostscript kræves af ocrmypdf.
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils ghostscript \
      tesseract-ocr tesseract-ocr-dan tesseract-ocr-eng tesseract-ocr-osd \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ocr.py soegeord.py stopord_da.txt ordfrekvens_da.txt ./

# OMP_THREAD_LIMIT=1: tesseract bruger én kerne, så Directus forbliver responsiv, mens en OCR kører.
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOME=/tmp OMP_THREAD_LIMIT=1
USER 1000:1000
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
