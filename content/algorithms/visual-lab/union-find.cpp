#include <iostream>
int find(int parent[], int x) {
    if (parent[x] != x) { parent[x] = find(parent, parent[x]); }
    return parent[x];
}

int main() {
    int n; int count; std::cin >> n >> count;
    int parent[8]; int rank[8] = {};
    for (int i = 0; i < n; i = i + 1) { parent[i] = i; }
    // 开始观察算法
    for (int step = 0; step < count; step = step + 1) {
        int command; int x; int y; std::cin >> command >> x >> y;
        int rootX = find(parent, x);
        if (command == 2) { std::cout << rootX << " "; }
        else {
            int rootY = find(parent, y);
            if (rootX != rootY) {
                if (rank[rootX] < rank[rootY]) { parent[rootX] = rootY; }
                else { parent[rootY] = rootX; if (rank[rootX] == rank[rootY]) { rank[rootX] = rank[rootX] + 1; } }
            }
        }
    }
    std::cout << "\n";
    return 0;
}
