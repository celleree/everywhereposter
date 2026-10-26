FROM python:3.13.7-slim-bookworm@sha256:adafcc17694d715c905b4c7bebd96907a1fd5cf183395f0ebc4d3428bd22d92d
WORKDIR /adapter
COPY . /adapter
RUN python -c "import hashlib,json,urllib.request; p=json.load(open('runtime/tools.lock.json')); b=urllib.request.urlopen(p['ytDlpUrl'],timeout=30).read(); assert hashlib.sha256(b).hexdigest()==p['ytDlpSha256']; open('/opt/yt-dlp','wb').write(b)" \
 && mkdir /ipc /job && chown 10001:10001 /ipc /job
USER 10001:10001
ENV HOME=/job PYTHONDONTWRITEBYTECODE=1
CMD ["python", "-c", "import time; time.sleep(360)"]
