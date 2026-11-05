#include <iostream>

int main() {
    int n; int edges; int start; int mode;
    std::cin >> n >> edges >> start >> mode;
    int graph[36] = {};
    for (int edge = 0; edge < edges; edge = edge + 1) {
        int u; int v; int weight; std::cin >> u >> v >> weight;
        graph[u * n + v] = weight;
        graph[v * n + u] = weight;
    }
    int distance[6]; int parent[6]; int seen[6] = {}; int total = 0;
    for (int i = 0; i < n; i = i + 1) { distance[i] = 10000; parent[i] = -1; }
    distance[start] = 0;
    // 开始观察算法
    for (int step = 0; step < n; step = step + 1) {
        int current = -1;
        for (int v = 0; v < n; v = v + 1) {
            if (seen[v] == 0 && (current == -1 || distance[v] < distance[current])) { current = v; }
        }
        if (current == -1 || distance[current] == 10000) { break; }
        seen[current] = 1; total = total + distance[current];
        for (int v = 0; v < n; v = v + 1) {
            int weight = graph[current * n + v];
            if (weight > 0 && seen[v] == 0 && weight < distance[v]) {
                distance[v] = weight; parent[v] = current;
            }
        }
    }
    int complete = 1;
    for (int v = 0; v < n; v = v + 1) { if (seen[v] == 0) { complete = 0; } }
    if (complete == 1) { std::cout << total; } else { std::cout << "disconnected"; }
    std::cout << "\n";
    return 0;
}
