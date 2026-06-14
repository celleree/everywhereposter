'use client';

import { FC, useEffect, useMemo, useRef } from 'react';
import DrawChart from 'chart.js/auto';
import { chunk } from 'lodash';
import useCookie from 'react-use-cookie';

type ChartPoint = { total: number | string; date: string };

function mergeDataPoints(data: ChartPoint[], numPoints: number): ChartPoint[] {
  const res = chunk(data, Math.ceil(data.length / numPoints));
  return res.map((row) => {
    return {
      date: `${row[0].date} - ${row?.at(-1)?.date}`,
      total: row.reduce((acc, curr) => acc + Number(curr.total || 0), 0),
    };
  });
}

export const ChartSocial: FC<{
  data: ChartPoint[];
  color?: 'purple' | 'green' | 'blue';
  directPoints?: boolean;
}> = (props) => {
  const { data, color = 'purple', directPoints = false } = props;
  const [mode] = useCookie('mode', 'dark');
  const list = useMemo(() => {
    const points = directPoints ? data : mergeDataPoints(data, 7);
    return points.map((row) => ({
      ...row,
      total: Number(row.total || 0),
    }));
  }, [data, directPoints]);
  const isSinglePoint = list.length === 1;
  const ref = useRef<any>(null);
  const chart = useRef<null | DrawChart>(null);

  const colorSchemes = {
    purple: {
      start: 'rgba(97, 43, 211, 0.8)',
      end: 'rgba(97, 43, 211, 0.1)',
      border: 'rgb(97, 43, 211)',
    },
    green: {
      start: 'rgba(50, 213, 131, 0.8)',
      end: 'rgba(50, 213, 131, 0.1)',
      border: 'rgb(50, 213, 131)',
    },
    blue: {
      start: 'rgba(29, 155, 240, 0.8)',
      end: 'rgba(29, 155, 240, 0.1)',
      border: 'rgb(29, 155, 240)',
    },
  };

  const colors = colorSchemes[color];

  useEffect(() => {
    const ctx = ref.current.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, ref.current.height);
    gradient.addColorStop(0, colors.start);
    gradient.addColorStop(1, colors.end);

    chart.current = new DrawChart(ref.current!, {
      type: isSinglePoint ? 'bar' : 'line',
      options: {
        maintainAspectRatio: false,
        responsive: true,
        animation: {
          duration: 750,
          easing: 'easeOutQuart',
        },
        interaction: {
          mode: 'index',
          intersect: false,
        },
        layout: {
          padding: {
            left: 0,
            right: 0,
            top: 4,
            bottom: 0,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            display: false,
          },
          x: {
            display: false,
            ticks: {
              stepSize: 10,
              maxTicksLimit: 7,
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: true,
            backgroundColor: mode === 'dark' ? '#1e1d1d' : '#fff',
            titleColor: mode === 'dark' ? '#fff' : '#000',
            bodyColor: mode === 'dark' ? '#9c9c9c' : '#777',
            borderColor: mode === 'dark' ? '#2b2b2b' : '#e7e9eb',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            titleFont: {
              size: 12,
              weight: 'normal',
            },
            bodyFont: {
              size: 14,
              weight: 'bold',
            },
          },
        },
      },
      data: {
        labels: list.map((row) => row.date),
        datasets: [
          {
            borderColor: colors.border,
            borderWidth: isSinglePoint ? 0 : 2,
            label: 'Total',
            backgroundColor: isSinglePoint ? colors.border : gradient,
            fill: false,
            data: list.map((row) => row.total),
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointBackgroundColor: colors.border,
            pointHoverBackgroundColor: colors.border,
            pointHoverBorderColor: mode === 'dark' ? '#1e1d1d' : '#fff',
            pointHoverBorderWidth: 2,
            ...(isSinglePoint
              ? {
                  borderRadius: 6,
                  barPercentage: 0.5,
                  categoryPercentage: 0.7,
                  maxBarThickness: 34,
                }
              : {}),
          },
        ],
      },
    });
    return () => {
      chart?.current?.destroy();
    };
  }, []);

  return <canvas className="w-full h-full" ref={ref} />;
};
