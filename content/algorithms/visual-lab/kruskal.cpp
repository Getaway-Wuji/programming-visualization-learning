#include <iostream>
int find(int parent[], int node) {
    if (parent[node] != node) { parent[node] = find(parent, parent[node]); }
    return parent[node];
}

int main() {
    int n; int edges; int start; int mode;
    std::cin >> n >> edges >> start >> mode;
    int from[8]; int to[8]; int weight[8]; int chosen[8] = {}; int parent[6];
    for (int edge = 0; edge < edges; edge = edge + 1) { std::cin >> from[edge] >> to[edge] >> weight[edge]; }
    // 开始观察算法
    for (int i = 1; i < edges; i = i + 1) {
        int u = from[i]; int v = to[i]; int w = weight[i]; int j = i - 1;
        while (j >= 0 && weight[j] > w) { from[j + 1] = from[j]; to[j + 1] = to[j]; weight[j + 1] = weight[j]; j = j - 1; }
        from[j + 1] = u; to[j + 1] = v; weight[j + 1] = w;
    }
    for (int i = 0; i < n; i = i + 1) { parent[i] = i; }
    int total = 0; int count = 0;
    for (int edge = 0; edge < edges; edge = edge + 1) {
        int u = find(parent, from[edge]); int v = find(parent, to[edge]);
        if (u != v) { parent[u] = v; chosen[edge] = 1; total = total + weight[edge]; count = count + 1; }
    }
    if (count == n - 1) { std::cout << total; } else { std::cout << "disconnected"; }
    std::cout << "\n";
    return 0;
}
