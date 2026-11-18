FROM python:3.13.7-slim-bookworm@sha256:adafcc17694d715c905b4c7bebd96907a1fd5cf183395f0ebc4d3428bd22d92d
WORKDIR /adapter
COPY . /adapter
RUN python -B runtime/download_tool.py \
 && mkdir /ipc /job && chown 10001:10001 /ipc /job
USER 10001:10001
ENV HOME=/job PYTHONDONTWRITEBYTECODE=1
CMD ["python", "-c", "import time; time.sleep(360)"]
