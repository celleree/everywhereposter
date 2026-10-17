# Local candidate only. Pass the locally resolved official Python image digest.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY wheels /wheels
COPY requirements.lock /tmp/requirements.lock
RUN python -m pip install --no-index --find-links=/wheels --require-hashes -r /tmp/requirements.lock \
 && python -m pip check \
 && rm -rf /wheels /root/.cache
COPY upstream /opt/upstream
COPY model /opt/model
COPY source-manifest.json /opt/source-manifest.json
COPY MODEL-NOTICES.md /opt/MODEL-NOTICES.md
COPY worker-smoke.py /opt/worker-smoke.py
ENV HOME=/work/home AI_EDITOR_HOME=/work/home AI_EDITOR_LIBRARY=/work/library \
 AI_EDITOR_WHISPER_MODEL=/opt/model HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
 OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["python","-I","/opt/worker-smoke.py"]
